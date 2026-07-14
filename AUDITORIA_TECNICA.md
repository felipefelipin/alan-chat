# Auditoria Técnica — Arquitetura de Chat, Teclado, Scroll e Viewport

**Escopo**: `public/app.js`, `public/styles.css`, `public/index.html` (mini app "WhatsApp-clone").
**Metodologia**: leitura completa do código-fonte atual (commit `162367b`, branch `main`), sem execução em device real — os itens marcados como "confirmado por leitura de código" são certezas estruturais; os itens marcados como "risco não verificado em device" são hipóteses fundamentadas que precisam de teste manual para confirmação definitiva.
**Nenhum arquivo do projeto foi alterado para produzir esta auditoria.**

---

## 1. Arquitetura atual

### 1.1 Visão geral

O chat principal é renderizado dinamicamente via `mountChat()` (`app.js:~840-918`), que injeta o HTML de `.full > .topbar + .chatShell > .chat + .composer` em `#app` (`app.innerHTML = ...`). Depois do mount, quatro coisas são religadas, nesta ordem:

1. `restoreHistory()` — repopula `#chat` com o histórico salvo em `localStorage`.
2. `handleScrollDetection()` — liga um listener de `scroll` em `#chat` que mantém a flag global `isUserNearBottom`.
3. `bindComposer()` — liga listeners de `input`/`keydown` no campo de mensagem (não relacionados a teclado/viewport).
4. `KeyboardController.attach(input, chat)` — o controlador central de foco/blur/scroll-de-ancoragem/altura de viewport.

`KeyboardController` (IIFE em `app.js:226-397`) é o **único módulo com a responsabilidade explícita e documentada** de: focus/blur do `#input`, o gesto de "scroll pra cima fecha o teclado", e a sincronização de `--kb-height`/`--kb-offset` (custom properties CSS lidas por `#app`/`.full` em `styles.css`) via polling de `window.visualViewport` dentro de `requestAnimationFrame`.

### 1.2 Estratégia de altura: CSS-first, JS como reforço

`#app` e `.full` (`styles.css:33-52` e `:1277-1290`) declaram, em cascata:

```css
height: 100vh;                       /* fallback puro */
height: 100dvh;                      /* nativo, se o engine honrar interactive-widget=resizes-content */
height: var(--kb-height, 100dvh);    /* reforço JS, só ativo durante a ABERTURA do teclado */
transform: translateY(var(--kb-offset, 0px));
```

`public/index.html` declara `<meta name="viewport" content="...,interactive-widget=resizes-content">` — pedindo explicitamente ao engine para redimensionar o layout viewport nativamente. Como documentado internamente no código (`app.js:184-232`) e confirmado por pesquisa de plataforma nesta sessão, **nem toda WebView embarcada honra esse pedido** — daí a existência do reforço via `--kb-height`.

### 1.3 Assimetria abertura/fechamento (decisão deliberada, não descuido)

Esta é a característica arquitetural mais importante do sistema atual, e o resultado direto de várias iterações de correção nesta mesma sessão:

- **Na abertura** (`onFocus`, `app.js:307-310`): `startFollowing()` inicia um loop de `requestAnimationFrame` que, a cada frame, lê `visualViewport.height`/`offsetTop`, escreve `--kb-height`/`--kb-offset`, e ajusta `chat.scrollTop = chat.scrollHeight - chat.clientHeight` — tudo na mesma leitura de frame. O loop se autoencerra após `FOLLOW_STABLE_FRAMES` (3) frames consecutivos sem mudança de altura, com um teto de segurança de `FOLLOW_SAFETY_FRAMES` (180 frames, ~3s).
- **No fechamento** (`onBlur`, `app.js:314-318`): **nenhum JS escreve layout**. Apenas cancela um eventual loop de abertura ainda ativo e remove `--kb-height`/`--kb-offset` do DOM imediatamente, devolvendo o controle inteiro ao CSS/engine nativo.

Essa assimetria existe porque, nas iterações anteriores desta sessão, rodar o mesmo loop de sincronização também no fechamento causava um bug reproduzível: o teclado deixava de reabrir no primeiro toque seguinte (ver Bug 1, seção 4).

### 1.4 Gesto de fechar por scroll

`onChatScroll`/`onChatTouchStart`/`onChatTouchEnd` (`app.js:319-345`) implementam "scroll decisivo pra cima fecha o teclado" (padrão WhatsApp). A chamada real a `input.blur()` é deliberadamente adiada: se o scroll que cruza o limiar (`SCROLL_DISMISS_PX = 44`) acontece com o dedo ainda tocando a tela (`touching === true`), a intenção é só marcada (`pendingDismiss = true`) e o `blur()` de fato só dispara no `touchend`/`touchcancel`. Se o limiar é cruzado já em fase de inércia (dedo solto), o `blur()` dispara imediatamente.

### 1.5 Segundo sistema de scroll, independente do KeyboardController

Existe um mecanismo de scroll **completamente separado**, para uma finalidade diferente (manter a conversa no fim quando **novas mensagens chegam**, não quando o teclado abre): `scrollBottom(force)` → `scrollToBottom()` (`app.js:1481-1492`), chamado em dezenas de pontos do fluxo de mensagens (`app.js:1822` e adiante). Ver seção 2.1 para o conflito potencial entre os dois sistemas.

### 1.6 Um segundo composer, fora da arquitetura do KeyboardController

`openStoryReply()` (`app.js:3197-3332`) implementa uma barra de resposta a Stories com seu **próprio** input (`#storyReplyInput`), seu próprio CSS injetado dinamicamente (`#storyReplyCSS`, `app.js:3208-3243`), e seu próprio padrão de abertura de teclado via "ghost input" (um `<input>` invisível focado primeiro, depois o foco é transferido ao input real). Esse subsistema **não usa `KeyboardController`, `visualViewport`, nem `--kb-height`** — ver Bug/Achado novo 6, seção 2.

---

## 2. Problemas encontrados

### 2.1 [NOVO] Dois sistemas de scroll escrevendo em `chat.scrollTop` de forma independente

`KeyboardController.applyFrame` (`app.js:261-268`) e `scrollToBottom()` (`app.js:1481-1484`) escrevem ambos em `chat.scrollTop`, sem nenhuma coordenação entre si. `scrollToBottom()` é chamado em qualquer novo evento do fluxo de mensagens (mensagem enviada, recebida, indicador de "digitando", mídia renderizada — mais de 10 call sites). Se uma nova mensagem chega **durante** a janela em que o usuário está focando o input (teclado abrindo, loop de `KeyboardController` ativo), os dois sistemas escrevem `scrollTop` em momentos potencialmente diferentes do mesmo ciclo de eventos — um baseado em `requestAnimationFrame` contínuo, o outro em `requestAnimationFrame` + `setTimeout(50)` (ver 2.2). Não é garantido qual "vence" em cada frame.

### 2.2 [NOVO] `scrollToBottom()` usa `setTimeout(50)` como rede de segurança

```js
// app.js:1481-1484
function scrollToBottom() {
  requestAnimationFrame(() => { const el = state.chatEl; if (el) el.scrollTop = el.scrollHeight; });
  setTimeout(() => { const el = state.chatEl; if (el) el.scrollTop = el.scrollHeight; }, 50);
}
```

O comentário original ("RAF prevents WebKit GPU black square; setTimeout(50) ensures iOS layout has settled") indica que isso resolve um problema *diferente* (renderização de novas mensagens), não o das transições de teclado — mas é, por definição, exatamente o padrão "scroll após timeout" que a arquitetura do `KeyboardController` foi desenhada para eliminar. Ele continua presente, sem relação direta com os bugs de teclado, mas é uma inconsistência de padrão dentro da mesma base de código.

### 2.3 [NOVO] Múltiplos pontos de `blur()`/`focus()` fora do `KeyboardController`

O comentário arquitetural em `app.js:180-182` declara: *"Nenhum outro trecho do app deve tocar em chat.scrollTop / --kb-height / --kb-offset / input.blur() fora daqui."* Isso não é verdade no código atual — a intenção documentada não é reforçada estruturalmente (o `#input` é um elemento DOM global; qualquer função com uma referência pode chamar `.focus()`/`.blur()` nele). Pontos identificados:

| Local | Chamada | Contexto |
|---|---|---|
| `app.js:1962` | `input.focus()` | `onSend()` — reabre o teclado após enviar mensagem |
| `app.js:2089` | `document.activeElement?.blur()` | `showIncomingCall()` — força fechar teclado antes da tela de chamada |
| `app.js:2092` | `inp.readOnly = true; inp.blur(); setTimeout(...300ms)` | `showIncomingCall()` — ver 2.4 |
| `app.js:2564` | `document.activeElement?.blur()` | `showCountdown()` |
| `app.js:3003` | `activeEl.blur()` | `showStories()` |
| `app.js:3252` | `ghost.focus()` | `openStoryReply()` — input paralelo |
| `app.js:3324` | `input.focus()` | `openStoryReply()` — input paralelo |

Nenhuma dessas chamadas é, isoladamente, incorreta — mas todas disparam o evento nativo `focus`/`blur` do `#input`, que o `KeyboardController` está escutando (`app.js:383-384`), então cada uma delas **aciona indiretamente `onFocus`/`onBlur`**, e por consequência o loop de `requestAnimationFrame`, a partir de um contexto que o `KeyboardController` não controla nem conhece a intenção.

### 2.4 [NOVO] Hack real: `readOnly` + `setTimeout(300)` para forçar fechamento do teclado

```js
// app.js:2087-2093
function showIncomingCall() {
  // Força fechar teclado antes de mostrar a tela de chamada
  try { document.activeElement?.blur(); } catch {}
  try {
    const inp = document.querySelector("input,textarea");
    if (inp) { inp.readOnly = true; inp.blur(); setTimeout(() => { inp.readOnly = false; }, 300); }
  } catch {}
  ...
```

Isso é, precisamente, o padrão que as últimas seis iterações desta sessão trabalharam para eliminar do fluxo principal do teclado (timeout fixo de 300ms como garantia de que o teclado "realmente" fechou). Está fora do escopo do `KeyboardController`, num fluxo diferente (tela de chamada recebida), mas é uma inconsistência de padrão arquitetural dentro do mesmo arquivo.

### 2.5 [NOVO] `class="full"` com `style` inline sobrescreve `--kb-height` silenciosamente

A classe CSS `.full` é reutilizada por pelo menos dois contextos: o chat principal (`mountChat()`, sem `style` inline — a regra `height: var(--kb-height, 100dvh)` do CSS externo se aplica normalmente) e o visualizador de Stories (`app.js:3046-3052`, que declara `<div class="full" style="...height:100dvh;...">`). **Estilo inline sempre vence estilo de folha de estilos externa**, independente de especificidade de seletor — então, no visualizador de Stories, a reforço `--kb-height` do `KeyboardController` **nunca tem efeito**, mesmo que o loop de sincronização esteja rodando (não deveria estar, já que Stories não tem input de texto focável — mas se essa suposição mudar no futuro, o bug reaparece silenciosamente).

### 2.6 [NOVO — potencialmente Crítico] Composer de resposta a Stories não tem nenhuma proteção de teclado

```css
/* app.js:3211-3219, injetado dinamicamente */
#storyBottomBlock {
  position: fixed;
  left: 0; right: 0;
  top: 0; bottom: 0;
  ...
}
```

`#storyBottomBlock` é `position:fixed` com `bottom:0`, ancorado à borda inferior do **layout viewport**. Em qualquer engine operando no modo padrão `resizes-visual` (o padrão do Chrome desde a versão 108, e o que a auditoria da própria sessão já identificou como o comportamento mais provável da WebView do Telegram — ver `Docs/06-Android.md`), `bottom:0` **não se move** quando o teclado abre — o layout viewport não encolhe nesse modo, só o visual viewport. Isso significa que a barra de resposta a Stories (`#replyBarKeyboard`, o input real) provavelmente fica **posicionada atrás do teclado**, não colada acima dele, no mesmo tipo de dispositivo onde o chat principal já teve exatamente esse sintoma antes das correções desta sessão. Este subsistema não usa `visualViewport`, `--kb-height`, nem qualquer parte do `KeyboardController`. **Risco não verificado em device — requer teste manual para confirmar**, mas a leitura de código não deixa dúvida sobre a ausência do mecanismo de proteção.

### 2.7 Nudge de `scrollTop` para forçar layer de GPU

```js
// app.js:910-917
requestAnimationFrame(() => {
  const chat = document.getElementById("chat");
  if (!chat) return;
  const s = chat.scrollTop;
  chat.scrollTop = s + 1;
  chat.scrollTop = s;
});
```

Hack documentado no próprio comentário ("Force GPU compositor layer to activate before first touch"). Baixo risco isolado, mas é mais um ponto que escreve `scrollTop` fora do `KeyboardController`, executado uma vez logo após `mountChat()` — se o usuário conseguisse focar o input rápido o suficiente para esse `requestAnimationFrame` coincidir com o loop do `KeyboardController` (janela de um frame, extremamente improvável mas não impossível), haveria uma escrita concorrente adicional.

### 2.8 `#app`/`.full` recebem `transform` — verificado, sem efeito colateral confirmado

`--kb-offset` é aplicado via `transform: translateY(...)` em `#app` e `.full` (`styles.css:51` e equivalente em `.full`). `transform` cria um novo *containing block* para descendentes `position:fixed`/`absolute`. Nesta auditoria, **todos** os overlays `position:fixed` do projeto (`photoPreviewOverlay`, tela de chamada, countdown, `storyReplyOverlay`, toasts) foram confirmados como filhos diretos de `document.body` (não descendentes de `.full`/`#app`), então não há efeito colateral de containing-block hoje. **Isso é frágil**: qualquer novo overlay `position:fixed` adicionado como descendente de `.full`/`#app` no futuro herdaria esse containing-block sem aviso, e passaria a se posicionar relativo a `.full` em vez do viewport real.

---

## 3. Causa raiz — os 5 bugs relatados

### Bug 1 — Precisa tocar duas vezes para reabrir o teclado

**Estado atual**: corrigido no commit `162367b` (`fix: causa raiz do bug do segundo toque`). **Causa raiz identificada e documentada no próprio código** (`app.js:213-232`): o loop de `requestAnimationFrame` que sincroniza `--kb-height`/`--kb-offset` chegou a rodar também durante o **fechamento** do teclado (versão anterior, commits `a8d7d53`/`7eeac39`), escrevendo layout a cada frame enquanto o sistema operacional ainda processava sua própria animação de fechamento. Duas fontes de mudança de layout (SO + JS) competindo pelo mesmo espaço ao mesmo tempo deixava a associação interna input↔IME da WebView inconsistente — o DOM aceitava o `focus()` do toque seguinte normalmente, mas o teclado físico não subia, só no segundo toque. A correção (seção 1.3 desta auditoria) elimina toda escrita de JS durante o fechamento.
**Risco residual**: os pontos identificados em 2.3 (`onSend`, `showIncomingCall`, `showCountdown`, `showStories`) disparam `focus()`/`blur()` fora do fluxo canônico de toque no input — nenhum deles foi testado explicitamente contra este bug específico nesta auditoria. `onSend()` (`app.js:1962`) é o mais crítico: chama `input.focus()` programaticamente, imediatamente após o usuário enviar uma mensagem — se essa chamada, em algum device, se comportar como um "focus sem gesto direto o suficiente" (Capítulo 7 da documentação produzida nesta sessão, restrição de foco do WebKit), o mesmo padrão de bug pode se manifestar aqui, fora do escopo do que já foi corrigido.

### Bug 2 — Faixa/área preta ao fechar o teclado

**Estado atual**: mitigado indiretamente pela migração para `100dvh` + `interactive-widget=resizes-content` (commit anterior à v129) — a causa original era o container `#app`/`.full` permanecer no tamanho antigo (JS desatualizado ou CSS não reativo) enquanto a área visível real já havia mudado, expondo o `background` do `body` por baixo. **Risco residual não verificado**: como o fechamento hoje depende 100% do CSS/engine nativo (seção 1.3), se a WebView em uso **não** honrar `interactive-widget=resizes-content` (comportamento não garantido, ver `Docs/06-Android.md`), o `dvh` do `#app` não vai encolher/crescer em sincronia real com o teclado fechando, e o sintoma original pode reaparecer — sem que exista, hoje, nenhum reforço de JS para esse cenário específico no fechamento (a decisão da seção 1.3 foi deliberadamente trocar "risco de área preta" por "risco de precisar de dois toques", que era o bug mais grave dos dois).

### Bug 3 — Última mensagem se afasta do input e depois desce (duplo movimento na abertura)

**Estado atual**: corrigido nos commits `243ccb0`/`7eeac39`. Causa raiz: altura do container e `scrollTop` eram calculados em momentos diferentes — inicialmente via leitura de `chat.clientHeight` (que só reflete o resize *depois* que o engine já processou, não durante), depois via eventos de `visualViewport.resize`/`scroll`, que o engine coalesce e entrega só ao final da animação do teclado — produzindo um primeiro ajuste com dados desatualizados e um segundo ajuste tardio quando o dado correto finalmente chegava. A correção final (`applyFrame`, `app.js:261-268`) lê `visualViewport.height`/`offsetTop` **diretamente como propriedade**, dentro do loop de `requestAnimationFrame` — nunca esperando por evento — e calcula `scrollTop` na mesma leitura de frame que a altura, eliminando a possibilidade estrutural de dois ajustes distintos.

### Bug 4 — Scroll trava temporariamente ao fechar o teclado

**Estado atual**: mitigado como efeito colateral da correção do Bug 2 original (container com altura correta = área scrollável com limites corretos = sem sensação de "travado"). Como o fechamento não tem mais nenhum JS ativo (seção 1.3), não há, hoje, nenhum código que bloqueie `touchmove`/`scroll`/`wheel` — confirmado por leitura: nenhum listener no projeto chama `preventDefault()` em `touchmove`/`scroll`/`wheel` dentro do fluxo do `KeyboardController` (a única chamada de `preventDefault()` em `touchmove` do projeto inteiro é em `app.js:471`, no preview de foto por long-press, um fluxo completamente independente). **Risco residual**: o mesmo risco do Bug 2 — se `interactive-widget=resizes-content` não for honrado pela WebView real, a área scrollável pode temporariamente ter limites incorretos durante o fechamento, reproduzindo a sensação de "travado" como sintoma derivado.

### Bug 5 — Delay no fechamento

**Estado atual**: mesma causa raiz do Bug 2/4 — decorre inteiramente de quão rápido o CSS/engine nativo reage ao fechamento real do teclado, já que nenhum JS participa mais dessa transição. Isso significa que a percepção de "delay" hoje depende **inteiramente** da qualidade da implementação de `interactive-widget=resizes-content` na WebView do device do usuário — uma variável que este projeto não controla e não tem telemetria para confirmar em produção.

### Padrão comum aos 5 bugs

Todos compartilham a mesma causa raiz de fundo, hoje resolvida para o fluxo principal de uma forma específica: **o sistema decidiu explicitamente confiar no CSS/engine nativo para o fechamento, e reservar controle ativo via JavaScript apenas para a abertura** — uma troca deliberada entre dois riscos (bug funcional grave vs. possível imperfeição cosmética), não uma eliminação total de risco. A validação real desse trade-off depende de teste em device, que esta auditoria (leitura de código) não pode substituir.

---

## 4. Impacto

| Achado | Impacto se não tratado |
|---|---|
| 2.1 — dois sistemas de scroll concorrentes | Mensagem recebida durante abertura do teclado pode produzir posição de scroll inconsistente/piscando |
| 2.2 — `setTimeout(50)` em `scrollToBottom` | Baixo — não relacionado a teclado, mas é dívida técnica/inconsistência de padrão |
| 2.3 — múltiplos `focus()`/`blur()` fora do controlador | Pode reintroduzir o Bug 1 em fluxos não cobertos pelos testes desta sessão (envio de mensagem, tela de chamada, countdown, stories) |
| 2.4 — hack `readOnly`+`setTimeout(300)` | Mesma classe de risco do Bug 1, isolada à tela de chamada recebida |
| 2.5 — `--kb-height` sobrescrito por inline style em Stories | Nenhum hoje (Stories não tem input); risco futuro se Stories ganhar campo de texto próprio sem reusar `KeyboardController` |
| 2.6 — composer de Stories sem proteção de teclado | **Alto** — o mesmo tipo de bug que motivou toda esta sessão de correções, provavelmente presente, não testado, sem nenhuma mitigação |
| 2.7 — nudge de scrollTop para GPU layer | Muito baixo — janela de conflito praticamente impossível na prática |
| 2.8 — `transform` cria containing block em `#app`/`.full` | Nenhum hoje; risco arquitetural futuro |
| Bug 1 (residual) | Se reproduzido via `onSend`/`showIncomingCall`/etc., o usuário fica sem conseguir digitar sem tocar duas vezes |
| Bugs 2/4/5 (residual) | Dependem inteiramente de comportamento de WebView não controlado nem verificado nesta auditoria |

---

## 5. Prioridade

| # | Item | Prioridade | Justificativa |
|---|---|---|---|
| 2.6 | Composer de Stories sem proteção de teclado | **Crítico** | Mesma classe de bug já comprovadamente grave no fluxo principal; feature ativa, provavelmente nunca testada sob essa lente |
| 2.3 (caso `onSend`) | `input.focus()` programático fora do controlador | **Alto** | Ponto de maior tráfego (dispara a cada mensagem enviada); risco direto de reintroduzir o Bug 1 |
| 2.4 | Hack `readOnly`+`setTimeout(300)` | **Alto** | Padrão explicitamente identificado como causa-raiz de bug grave em outro fluxo do mesmo projeto |
| Bugs 2/4/5 residual | Dependência não verificada de `interactive-widget` real | **Alto** | Sem telemetria/teste em device, é uma suposição não confirmada sustentando todo o fechamento do teclado |
| 2.1 | Dois sistemas de scroll concorrentes | **Médio** | Janela de conflito real, mas requer coincidência temporal específica (mensagem chegando durante abertura de teclado) |
| 2.3 (demais casos) | `blur()` em `showIncomingCall`/`showCountdown`/`showStories` | **Médio** | Fluxos menos frequentes que envio de mensagem, mas mesma classe de risco |
| 2.2 | `setTimeout(50)` em `scrollToBottom` | **Baixo** | Não relacionado a teclado; inconsistência de padrão, não bug ativo conhecido |
| 2.5 | `.full` inline style sobrescrevendo `--kb-height` | **Baixo** | Sem sintoma hoje; risco arquitetural latente |
| 2.7 | Nudge de GPU layer | **Baixo** | Janela de conflito praticamente teórica |
| 2.8 | `transform` como containing block | **Baixo** | Sem sintoma hoje; documentar como restrição de arquitetura para features futuras |

---

## 6. Plano de refatoração (proposta — não implementada)

Esta seção é uma proposta para aprovação. Nenhuma mudança foi aplicada.

1. **Unificar os dois sistemas de scroll (2.1/2.2)**: `scrollToBottom()`/`scrollBottom()` deveriam também calcular `scrollTop` a partir de `chat.scrollHeight - chat.clientHeight` (não apenas `scrollHeight`), e remover o `setTimeout(50)`, substituindo por uma segunda escrita dentro de um segundo `requestAnimationFrame` encadeado (padrão já usado em outros pontos do arquivo, ex. `app.js:2894`), eliminando o único `setTimeout` remanescente relacionado a scroll no fluxo principal.
2. **Centralizar de verdade o foco/blur (2.3)**: expor `KeyboardController.requestFocus()`/`KeyboardController.dismiss()` como API pública do módulo, e migrar todos os call sites listados na tabela da seção 2.3 para usá-la, em vez de chamar `.focus()`/`.blur()` diretamente no elemento. Isso não muda o comportamento de nenhum desses fluxos — só garante que toda intenção de foco passe pelo mesmo ponto de decisão.
3. **Remover o hack de `showIncomingCall` (2.4)**: substituir `readOnly + blur + setTimeout(300)` por `KeyboardController.dismiss()` (a API proposta no item 2), que já lida corretamente com o timing de fechamento sem timer arbitrário.
4. **Estender proteção de teclado ao composer de Stories (2.6)** — o item de maior prioridade: reusar `KeyboardController` (ou extrair sua lógica de sincronização de viewport para uma função genérica reutilizável por qualquer input do app) para `#storyReplyInput`, e substituir o posicionamento `position:fixed;bottom:0` de `#storyBottomBlock` por um container dimensionado com a mesma estratégia `dvh`/`--kb-height` usada em `.full`.
5. **Isolar o `transform` de `--kb-offset` (2.8)**: documentar explicitamente, como regra de projeto, que nenhum elemento `position:fixed`/`absolute` pode ser adicionado como descendente de `#app`/`.full` sem considerar esse containing block — ou, alternativamente, mover o `translateY(--kb-offset)` para um wrapper interno dedicado, preservando `#app`/`.full` livres de `transform`.
6. **Validação em device real dos Bugs 2/4/5 residuais**: antes de qualquer refatoração adicional de fechamento de teclado, obter confirmação empírica (gravação de tela em pelo menos um Android e um iPhone, dentro do Telegram real) de que `interactive-widget=resizes-content` está de fato sendo honrado — essa é a suposição sobre a qual toda a seção 1.3 desta arquitetura está construída, e não há, hoje, telemetria ou teste automatizado que a confirme.

Nenhum destes itens foi implementado. Aguardando aprovação para iniciar qualquer modificação.
