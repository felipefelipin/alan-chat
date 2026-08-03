const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (typeof tg.disableVerticalSwipes === "function") {
    tg.disableVerticalSwipes();
  }
  // tracking de abertura
  const _trackChatId = tg?.initDataUnsafe?.user?.id;
  if (_trackChatId) {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: String(_trackChatId), event: "MINIAPP_OPEN" }),
      keepalive: true,
    }).catch(() => {});
  }
}

if (tg?.BackButton) {
  tg.BackButton.show();
  tg.BackButton.onClick(() => { try { tg.close(); } catch {} });
}
history.pushState(null, "", location.href);
window.addEventListener("popstate", () => {
  history.pushState(null, "", location.href);
});

// Música da tela de entrada é um <audio> real, não Web Audio sintetizado —
// tem política de autoplay própria, mais rígida: diferente do AudioContext
// (que fica liberado pro resto da sessão assim que resumido uma vez com
// qualquer toque), um <audio>/<video> só recebe permissão de tocar com som
// perto o bastante de um gesto real. Por isso ela é criada e "destravada"
// (play+pause imediato) já no primeiro toque do usuário em QUALQUER lugar
// do app — bem antes da tela de entrada existir — e só reaproveitada
// (nunca recriada) lá na hora certa (ver runEntranceScreen).
const ENTRANCE_MUSIC_VOLUME = 0.15; // bem baixa — som ambiente, não o foco
let _entranceAudio = null;
function getEntranceAudio() {
  if (!_entranceAudio) {
    _entranceAudio = new Audio(ASSETS.entranceMusic);
    _entranceAudio.preload = "auto";
    _entranceAudio.volume = 0;
    // Muda por padrão até o momento exato da cortina (ver startEntranceMusic
    // em runEntranceScreen, onde é desmutada). Isso é uma trava permanente,
    // não alternada a cada tentativa de destravar — assim é impossível a
    // música vazar antes da hora, mesmo por uma fração de segundo, não
    // importa quantas vezes o código de destravamento rode (loading
    // screen, roleta, etc.) antes da tela de entrada existir.
    _entranceAudio.muted = true;
  }
  return _entranceAudio;
}
// Sobe o volume de 0 até targetVolume aos poucos — usado só no instante em
// que a cortina abre, pra a música "nascer" com fade-in em vez de entrar
// já no volume final.
function esFadeInAudio(audio, targetVolume, ms) {
  const steps = 24;
  const stepMs = ms / steps;
  let i = 0;
  audio.volume = 0;
  const timer = setInterval(() => {
    i++;
    audio.volume = Math.min(targetVolume, (targetVolume * i) / steps);
    if (i >= steps) clearInterval(timer);
  }, stepMs);
}
// Tenta destravar em qualquer um dos tipos de gesto (pointerdown/touchend/
// click) — WebViews variam em qual desses de fato disparam primeiro/são
// suportados — e insiste a cada toque até uma tentativa realmente resolver
// (play() só resolve quando o navegador aceitou tocar), em vez de desistir
// depois de uma única tentativa que pode falhar por motivo transitório.
// Roda mudo (ver getEntranceAudio) — é só permissão, nunca produz som.
let _entranceAudioUnlocked = false;
function _stopTryingToUnlockEntranceAudio() {
  ["pointerdown", "touchend", "click"].forEach((ev) =>
    document.removeEventListener(ev, _tryUnlockEntranceAudio, true)
  );
}
function _tryUnlockEntranceAudio() {
  if (_entranceAudioUnlocked) return;
  const a = getEntranceAudio();
  a.play().then(() => {
    _entranceAudioUnlocked = true;
    a.pause();
    a.currentTime = 0;
    _stopTryingToUnlockEntranceAudio();
  }).catch(() => {});
}
["pointerdown", "touchend", "click"].forEach((ev) =>
  document.addEventListener(ev, _tryUnlockEntranceAudio, { capture: true })
);

const app = document.getElementById("app");

const ASSETS = {
  privateIntro: "/assets/%23viralinstagramreelsvideo%E2%99%A5%EF%B8%8F.mp4",
  privateMusic: "/assets/private-music.mp3",
  intro: "/assets/intro.mp4",
  callVideo: "/assets/call-video-combined.mp4",
  ringtone: "/assets/ringtone.mp3",
  avatar: "/assets/4294967542.jpeg",
  entranceTeaser: "/assets/IMG_0330.mp4",
  connectionDonePhoto: "/assets/cd0bd8e2-7b68-462c-84a3-5b9953ae591c%20%281%29.jpeg",
  entranceMusic: "/assets/entrance-music-v2.m4a",
  media1: "/assets/grid-1.jpg",
  media2: "/assets/grid-2.jpg",
  media3: "/assets/grid-3.jpg",
  media4: "/assets/grid-4.jpg",
  // "lingerie.jpg" nunca existiu de fato no projeto (chave criada apontando
  // pra um arquivo que não estava na pasta assets) — por isso a Foto 2 do
  // chat nunca aparecia. Usando uma foto real já existente como provisória
  // até o Felipe trocar pela definitiva.
  lingerie: "/assets/photo_5062262078608968721_w.jpg",
  teaseVideo: "/assets/IMG_7330.MP4",
  teasePhotoPrivada: "/assets/4294967637.jpeg",
  teaseCallPhoto: "/assets/1917bef0-5e63-4eb8-b52b-7e2a5abcedf0.png",
  teaseVideo2: "/assets/tease2.mp4",
  teaseVideo3: "/assets/IMG_7330.MP4",
  teasePhoto: "/assets/tease-photo.jpg",
  audioMimimi: "/assets/audio-mimimi.mp3",
  audioCallInvite: "/assets/0715%287%29.MP3",
  countdownVideo: "/assets/checkout-video.mp4",
};

// Segundo bot/modelo (bot2.js/worker2.js) abre esse mesmo mini app, só que
// com "?persona=m2" na URL — isso permite ir diferenciando mídia por bot aos
// poucos, sem duplicar o site inteiro. Sem o parâmetro (link do bot1),
// comportamento continua idêntico ao de sempre.
const PERSONA = new URLSearchParams(location.search).get("persona") || "m1";
const ASSET_OVERRIDES = {
  m2: {
    privateIntro: "/assets/step2-video.mp4",
    entranceTeaser: "/assets/checkout-video.mp4",
    connectionDonePhoto: "/assets/rmkt-3.jpg",
  },
};
if (ASSET_OVERRIDES[PERSONA]) Object.assign(ASSETS, ASSET_OVERRIDES[PERSONA]);

function preloadMedia() {
  // O vídeo da tela de conexão precisa estar de verdade no DOM pra começar a
  // baixar no boot do app — WebKit/Safari não prioriza <video> fora da página,
  // então isso sem appendChild+load() não adiantava nada (delay na entrada).
  // mountBackgroundVideo() reaproveita esse mesmo elemento depois.
  try {
    const v = document.createElement("video");
    v.id = "lsPreloadVideo";
    v.src = ASSETS.privateIntro;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(v);
    v.load();
  } catch {}
  try { new Image().src = "/assets/chat-bg.png?v=9"; } catch {}
  // foto que substitui o vídeo parado quando o botão DESBLOQUEAR PRÊMIOS
  // aparece — sem preload, o <img> só começava a buscar nesse instante,
  // causando um delay visível antes de aparecer.
  try { new Image().src = ASSETS.connectionDonePhoto; } catch {}
}

// Preload do vídeo principal da chamada — chamado quando a tela de "chamada
// tocando" aparece (showIncomingCall), não no boot do app: só entra aqui
// quando uma chamada está realmente prestes a acontecer, então não
// desperdiça banda de quem nunca chega nessa etapa. Dá ao vídeo os
// segundos inteiros de "toque" como folga de buffer, de graça — startFunnelCall()
// reaproveita esse mesmo elemento (mesma técnica de lsPreloadVideo/
// mountBackgroundVideo), sem recriar nem re-baixar nada.
function preloadCallVideo() {
  if (document.getElementById("callVideoPreload")) return; // já rodando/feito
  try {
    const v = document.createElement("video");
    v.id = "callVideoPreload";
    v.src = ASSETS.callVideo;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "auto";
    v.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(v);
    v.load();
  } catch {}
}

const CONTACT = {
  name: "Gabriely Castro",
  username: "GabrielyCastro",
  bio: "Aqui você faz o que quiser comigo... 🔥",
  title: "Gabriely Castro",
};

const PERSIST_KEY = "gisa_webapp_state_v7";
const CHECKOUT_URL = "https://t.me/gabrielycastroof_bot"; // fallback sem Telegram WebApp

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const state = {
  step: 0,
  ring: null,
  chatEl: null,
  music: null,
  introVidEl: null,
  history: [],
  // categoria do lead (quente/curioso/timido/curto/frio) — classificada na
  // 1ª resposta da abertura (ver classifyLeadReply) e reaproveitada em
  // todas as ramificações seguintes do roteiro (seção 2, 3 e 5).
  leadCategory: null,
  // quantas vezes o lead já recusou a chamada de vídeo (ver showIncomingCall).
  declineCount: 0,
  flags: {
    entered: false,
    audioEnabled: false,
    routing: false,
    startedChat: false,
    // registro informativo (não usado para pular a tela — quem controla
    // o retorno de usuários recorrentes é o localStorage "gisa_checkout_done",
    // ver boot no fim do arquivo).
    rouletteDone: false,
  },
};

function snapshotForSave() {
  return {
    step: state.step,
    leadCategory: state.leadCategory,
    declineCount: state.declineCount,
    flags: {
      entered: !!state.flags.entered,
      audioEnabled: !!state.flags.audioEnabled,
      routing: false,
      startedChat: !!state.flags.startedChat,
      rouletteDone: !!state.flags.rouletteDone,
    },
    history: Array.isArray(state.history) ? state.history.slice(-220) : [],
    ui: { statusText: document.getElementById("status")?.textContent ?? "" },
  };
}

function saveState() {
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshotForSave())); } catch {}
}

function loadState() {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return;
  const data = safeJsonParse(raw);
  if (!data) return;
  if (typeof data.step === "number") state.step = data.step;
  if (data.flags && typeof data.flags === "object") {
    state.flags.entered = !!data.flags.entered;
    state.flags.audioEnabled = !!data.flags.audioEnabled;
    state.flags.startedChat = !!data.flags.startedChat;
    state.flags.rouletteDone = !!data.flags.rouletteDone;
    state.flags.routing = false;
  }
  if (Array.isArray(data.history)) state.history = data.history;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// Flow cancellation — incrementing _sleepGen causes all pending sleeps to throw
class FlowCancelledError extends Error {
  constructor() { super("flow_cancelled"); this.name = "FlowCancelledError"; }
}
let _sleepGen = 0;

function sleep(ms) {
  const gen = _sleepGen;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (_sleepGen !== gen) reject(new FlowCancelledError());
      else resolve();
    }, ms);
  });
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// guarda o último status setado (ex.: "digitando…", "gravando áudio…",
// "enviando vídeo…", "online") mesmo quando o elemento #status não existe
// no momento (usuário navegou pro perfil/stories) — permite reaplicar
// certinho quando o chat remonta, em vez de voltar sempre pro padrão.
let _lastStatusText = null;

function setStatus(text) {
  _lastStatusText = text || null;
  const el = document.getElementById("status");
  if (el) el.textContent = text || "online";
  saveState();
}

function vibrate(ms = 18) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

// Haptics nativos do Telegram (mais sutis/precisos que a Vibration API do
// browser) com fallback silencioso pra vibrate() em clientes sem suporte.
function hapticImpact(style = "medium") {
  try {
    if (tg?.HapticFeedback?.impactOccurred) { tg.HapticFeedback.impactOccurred(style); return; }
  } catch {}
  vibrate(style === "light" ? 6 : style === "heavy" ? 16 : 10);
}

function hapticNotify(type = "success") {
  try {
    if (tg?.HapticFeedback?.notificationOccurred) { tg.HapticFeedback.notificationOccurred(type); return; }
  } catch {}
  vibrate(14);
}

// ── FIX #4: showHome aponta para mountChat ────────────────────────────────────
function showHome() { mountChat(); }

// ==================== SISTEMA DE TECLADO v2 ====================
// Reconstrução completa — substitui o antigo KeyboardController.
//
// Máquina de estados determinística, quatro estados exclusivos:
//
//   Idle ──FOCUS_RECEIVED──▶ Opening ──VIEWPORT_STABLE──▶ Opened
//    ▲                                                        │
//    └──────────────── Closing ◀──BLUR_RECEIVED───────────────┘
//         (transição imediata e síncrona de volta a Idle)
//
// Um único dono por responsabilidade:
//   KeyboardMachine   — estado atual, geração atual, transições
//   ViewportTracker   — visualViewport -> --kb-height/--kb-offset (só em Opening)
//   ScrollController  — ancoragem de scroll no fim da conversa + gesto de
//                        scroll-pra-fechar; fecha chamando o mesmíssimo
//                        FocusGateway.requestDismiss() usado pelo toque fora
//                        do campo, então o teclado sempre fecha pelo mesmo
//                        caminho, não importa o gatilho
//   FocusGateway      — única autoridade de focus()/blur() no textarea real
//                        (a referência do elemento é privada ao módulo —
//                        nenhum outro trecho do arquivo pode chamar
//                        .focus()/.blur() nele diretamente; tem que passar
//                        por FocusGateway.requestFocus()/requestDismiss())
//
// Proteção contra callback de ciclo antigo: toda transição pra "Opening" ou
// "Closing" incrementa `generation`. O loop de requestAnimationFrame do
// ViewportTracker captura a geração no instante em que é criado e se
// autoverifica a cada frame (`if (myGeneration !== generation) return`) —
// não depende de lembrar de cancelar em nenhum ponto de entrada, é
// estruturalmente impossível um frame de um ciclo antigo alterar layout de
// um ciclo novo.
//
// Fechamento nunca escreve layout via JS (lição já provada em correções
// anteriores): "Closing" só limpa --kb-height/--kb-offset e devolve o
// controle ao CSS/dvh nativo — nenhum rAF roda durante o fechamento.

const KeyboardMachine = (() => {
  const VALID = new Set(["Idle", "Opening", "Opened", "Closing"]);
  let state = "Idle";
  let generation = 0;
  const listeners = new Set();

  function transition(next, event) {
    if (!VALID.has(next)) throw new Error(`KeyboardMachine: estado inválido "${next}"`);
    const prev = state;
    state = next;
    if (next === "Opening" || next === "Closing") generation++;
    listeners.forEach((fn) => fn(state, prev, event));
  }

  return {
    get state() { return state; },
    get generation() { return generation; },
    transition,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

const ScrollController = (() => {
  const SCROLL_DISMISS_PX = 44; // piso mínimo de distância — nunca fecha por 1-2px de ruído, mesmo com velocidade alta calculada em cima de uma amostra minúscula
  // Critério de fechamento é velocidade, não distância: abaixo desse limiar
  // (px/ms, medido no dedo, não no scrollTop) o gesto é "arrastar devagar" e
  // NUNCA fecha o teclado, não importa quão longe o scroll já foi — igual
  // WhatsApp/Telegram, onde dá pra ler o histórico inteiro com o teclado
  // aberto. 0.65px/ms ≈ 650px/s: bem acima do que um arrasto de leitura
  // deliberado produz, mas dentro da faixa de um flick curto e decidido.
  const FLICK_VELOCITY_PX_MS = 0.65;
  // Só os pontos de toque dos últimos ~120ms entram na conta da velocidade —
  // é a velocidade RECENTE do dedo que importa, não a média do gesto
  // inteiro. Assim um usuário que rola devagar por um tempo e só flicka no
  // final ainda é reconhecido corretamente como flick nesse instante.
  const VELOCITY_WINDOW_MS = 120;

  let chat = null;
  let touching = false;
  let gestureStartTop = 0;
  let pendingDismiss = false;
  let touchSamples = [];   // {y, t} — janela curta e recente do gesto em andamento
  let releaseVelocity = 0; // velocidade (px/ms) medida no instante do touchend — usada pra qualificar o scroll por inércia que continua depois do dedo solto

  // Todo remount (mountChat(), ex.: voltar do perfil/stories) chama attach()
  // de novo com um elemento novo — reseta o estado do gesto aqui, senão um
  // gesto em andamento na tela anterior (touching/pendingDismiss) ou uma
  // referência velha (gestureStartTop, medida contra o #chat antigo)
  // sobrevivia pro elemento novo e podia causar um fechamento fantasma ou
  // deixar de detectar um gesto genuíno na primeira interação depois de
  // voltar.
  function attach(chatEl) {
    chat = chatEl;
    touching = false;
    pendingDismiss = false;
    gestureStartTop = chat ? chat.scrollTop : 0;
    touchSamples = [];
    releaseVelocity = 0;
  }

  // chamado pelo ViewportTracker, na mesma leitura de frame que a altura —
  // altura e scroll sempre derivados da mesma amostra, nunca dessincronizados.
  // Nunca escreve enquanto o dedo está na tela: no primeiro toque no campo
  // de texto, o teclado nativo costuma demorar mais pra abrir (renderiza
  // pela 1ª vez), então a fase "Opening" dura mais — sem essa checagem,
  // esse loop brigava com o gesto de subir o scroll durante esse período
  // mais longo, empurrando de volta pro final a cada frame.
  function anchorToBottom() {
    if (!chat) return;
    if (touching) return;
    chat.scrollTop = chat.scrollHeight - chat.clientHeight;
  }

  function onTouchStart(e) {
    if (chat) gestureStartTop = chat.scrollTop;
    touching = true;
    pendingDismiss = false;
    const t = e.touches[0];
    touchSamples = t ? [{ y: t.clientY, t: performance.now() }] : [];
    releaseVelocity = 0;
  }

  // amostra bruta do dedo (não do scrollTop) — o scrollTop pode ser
  // suavizado/interpolado pelo engine durante o scroll nativo, então medir
  // velocidade diretamente no toque é a mesma técnica usada pelos
  // rastreadores de fling nativos (VelocityTracker no Android, o `velocity`
  // de UIPanGestureRecognizer no iOS).
  function onTouchMove(e) {
    if (!touching) return;
    const t = e.touches[0];
    if (!t) return;
    const now = performance.now();
    touchSamples.push({ y: t.clientY, t: now });
    const cutoff = now - VELOCITY_WINDOW_MS;
    while (touchSamples.length > 2 && touchSamples[0].t < cutoff) touchSamples.shift();
  }

  // velocidade recente em px/ms — positivo = dedo subindo na tela (arrastando
  // o conteúdo pra cima, mesma direção que fecha o teclado).
  function currentVelocity() {
    if (touchSamples.length < 2) return 0;
    const first = touchSamples[0];
    const last = touchSamples[touchSamples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (first.y - last.y) / dt;
  }

  // Só arma a detecção quando o teclado já terminou de abrir ("Opened"),
  // nunca durante "Opening" — enquanto o teclado está abrindo, o próprio
  // loop de reancoragem (ViewportTracker.runFollowLoop) escreve scrollTop a
  // cada frame pra acompanhar a altura encolhendo, e isso também dispara o
  // evento "scroll". Sem essa exclusão, reabrir o teclado logo depois de
  // fechá-lo por scroll podia disparar um fechamento fantasma no meio da
  // própria animação de abertura (o teclado "não abria", só depois de
  // vários toques). Nunca chama FocusGateway.requestDismiss() com o dedo
  // ainda na tela — só marca a intenção; a ação de fato só dispara no
  // touchend (gesto concluído) ou durante scroll por inércia com o dedo já
  // solto. O fechamento em si é sempre via requestDismiss(), o mesmo
  // caminho do toque fora do campo — nenhum bug novo, nenhuma escrita de
  // layout aqui.
  function onScroll() {
    if (KeyboardMachine.state !== "Opened") return;
    if (!chat) return;
    const scrolledUp = gestureStartTop - chat.scrollTop;
    if (scrolledUp <= SCROLL_DISMISS_PX) return;

    if (touching) {
      // Só marca intenção se a velocidade RECENTE do dedo já qualifica como
      // flick — um arrasto lento e decidido (ex.: lendo mensagens antigas)
      // nunca vira pendingDismiss, mesmo passando do piso de distância.
      if (currentVelocity() >= FLICK_VELOCITY_PX_MS) pendingDismiss = true;
      return;
    }

    // Dedo já solto — o scroll aqui é inércia/momentum nativo. Só fecha se
    // o release em si foi um flick; inércia depois de um arrasto lento
    // nunca dispensa o teclado, mesmo que a rolagem residual eventualmente
    // passe do piso de distância.
    if (releaseVelocity >= FLICK_VELOCITY_PX_MS) FocusGateway.requestDismiss();
  }

  function onTouchEnd() {
    touching = false;
    releaseVelocity = currentVelocity();
    if (pendingDismiss) { pendingDismiss = false; FocusGateway.requestDismiss(); }
  }

  function bindGestureListeners(chatEl) {
    chatEl.addEventListener("touchstart", onTouchStart, { passive: true });
    chatEl.addEventListener("touchmove", onTouchMove, { passive: true });
    chatEl.addEventListener("touchend", onTouchEnd, { passive: true });
    chatEl.addEventListener("touchcancel", onTouchEnd, { passive: true });
    chatEl.addEventListener("scroll", onScroll, { passive: true });
  }

  // Reancora a base de comparação do gesto pro scrollTop atual — chamada
  // sempre que algo alheio ao próprio gesto força o scroll pro fim (teclado
  // termina de abrir, ou uma mensagem nova cai e reancora o chat). Sem
  // isso, uma mensagem chegando bem no meio do gesto de puxar o scroll pra
  // fechar o teclado jogava o scrollTop de volta pro fim e apagava o
  // progresso do usuário sem ele perceber — o teclado simplesmente não
  // fechava, mesmo com o gesto certo.
  function syncGestureBaseline() {
    if (chat) gestureStartTop = chat.scrollTop;
  }

  KeyboardMachine.onChange((state) => {
    if (state === "Opened") syncGestureBaseline();
  });

  return { attach, anchorToBottom, bindGestureListeners, syncGestureBaseline };
})();

const ViewportTracker = (() => {
  const STABLE_FRAMES = 3;   // frames idênticos seguidos = animação estabilizou
  const SAFETY_FRAMES = 180; // ~3s a 60fps — teto de segurança, nunca deveria ser atingido
  const CLOSE_STABLE_FRAMES = 3; // idem, mas pro fechamento (janela bem mais curta)
  const CLOSE_SAFETY_FRAMES = 30; // ~0.5s a 60fps — a animação nativa de fechar é rápida

  function readViewport() {
    const vv = window.visualViewport;
    return vv ? { h: vv.height, top: vv.offsetTop } : { h: window.innerHeight, top: 0 };
  }

  function applyHeight(h, top) {
    document.documentElement.style.setProperty("--kb-height", h + "px");
    document.documentElement.style.setProperty("--kb-offset", top + "px");
  }

  function clearOverride() {
    document.documentElement.style.removeProperty("--kb-height");
    document.documentElement.style.removeProperty("--kb-offset");
  }

  function runFollowLoop(myGeneration) {
    let lastHeight = readViewport().h;
    let sawChange = false;
    let stableFrames = 0;

    function frame(frameCount) {
      if (myGeneration !== KeyboardMachine.generation) return; // ciclo antigo — autoencerrado

      const { h, top } = readViewport();
      applyHeight(h, top);
      ScrollController.anchorToBottom();

      if (Math.abs(h - lastHeight) > 0.5) { sawChange = true; lastHeight = h; stableFrames = 0; }
      else stableFrames++;

      const settled = sawChange && stableFrames >= STABLE_FRAMES;
      if (settled || frameCount >= SAFETY_FRAMES) {
        KeyboardMachine.transition("Opened", "VIEWPORT_STABLE");
        return;
      }
      requestAnimationFrame(() => frame(frameCount + 1));
    }
    requestAnimationFrame(() => frame(0));
  }

  // O fechamento nativo do teclado (dvh voltando ao tamanho cheio) continua
  // animando por alguns frames depois da transição pra "Idle" — uma única
  // chamada de anchorToBottom() no instante da transição fica desatualizada
  // assim que o container termina de crescer, deixando o scroll "travado"
  // até algo mais forçar um recálculo. Este loop reancora a cada frame até
  // a altura do viewport estabilizar de novo — só escreve scrollTop, nunca
  // --kb-height/--kb-offset (essa é a diferença que evita reintroduzir o
  // bug do "segundo toque" já resolvido antes).
  function runCloseSettleLoop(myGeneration) {
    let lastHeight = readViewport().h;
    let stableFrames = 0;

    function frame(frameCount) {
      if (myGeneration !== KeyboardMachine.generation) return; // teclado reabriu ou ciclo antigo — autoencerrado
      ScrollController.anchorToBottom();

      const h = readViewport().h;
      if (Math.abs(h - lastHeight) > 0.5) { lastHeight = h; stableFrames = 0; }
      else stableFrames++;

      if (stableFrames >= CLOSE_STABLE_FRAMES || frameCount >= CLOSE_SAFETY_FRAMES) return;
      requestAnimationFrame(() => frame(frameCount + 1));
    }
    requestAnimationFrame(() => frame(0));
  }

  KeyboardMachine.onChange((state) => {
    if (state === "Opening") runFollowLoop(KeyboardMachine.generation);
    else if (state === "Idle") {
      clearOverride();
      runCloseSettleLoop(KeyboardMachine.generation);
    }
  });

  // API experimental (Chrome) — quando disponível, recaptura a geometria em
  // mudanças fora do ciclo focus/blur (ex.: rotação com o teclado já aberto).
  if (window.visualViewport && "ongeometrychange" in window.visualViewport) {
    window.visualViewport.addEventListener("geometrychange", () => {
      if (KeyboardMachine.state === "Opened") KeyboardMachine.transition("Opening", "GEOMETRY_CHANGE");
    });
  }

  return {};
})();

const FocusGateway = (() => {
  let textarea = null; // privado — nenhum outro trecho do arquivo deve guardar essa referência
  let globalGuardsBound = false;

  function bindGlobalGuards() {
    if (globalGuardsBound) return;
    globalGuardsBound = true;
    // impede o WKWebView de aplicar scroll por cima do resize nativo do content viewport
    window.addEventListener("scroll", () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    }, { passive: true });
    document.addEventListener("scroll", () => {
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    }, { passive: true });
  }

  function onOutsideTap(e) {
    if (KeyboardMachine.state === "Idle") return;
    if (e.target === textarea) return;
    requestDismiss();
  }

  function requestFocus() { textarea?.focus(); }

  function requestDismiss() {
    if (textarea && document.activeElement === textarea) textarea.blur();
  }

  // religa aos elementos do chat atual — chamado a cada mountChat() (remount destrói os listeners antigos)
  function attach(textareaEl, chatEl) {
    textarea = textareaEl;
    if (!textarea || !chatEl) return;

    bindGlobalGuards();
    ScrollController.attach(chatEl);
    ScrollController.bindGestureListeners(chatEl);

    textarea.addEventListener("focus", () => KeyboardMachine.transition("Opening", "FOCUS_RECEIVED"));
    textarea.addEventListener("blur", () => {
      KeyboardMachine.transition("Closing", "BLUR_RECEIVED");
      KeyboardMachine.transition("Idle", "CLOSED"); // fechamento é sempre síncrono, nunca assíncrono
    });

    chatEl.addEventListener("click", onOutsideTap);
  }

  return { attach, requestFocus, requestDismiss };
})();

// ==================== PROFILE PHOTO PREVIEW (long press) ====================
// Componente reutilizável: press-and-hold num avatar amplia a foto no lugar
// (estilo WhatsApp). Cresce a partir da posição/tamanho reais (FLIP), anima só
// transform+opacity (GPU), sem timers de animação — só o timer do long press em si.
const LONG_PRESS_MS = 340;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const LONG_PRESS_DRAG_CANCEL = 60;

let _photoPreview = null; // { overlay, img } enquanto aberto

function attachProfilePhotoPreview(container, { onTap } = {}) {
  const img = container?.querySelector("img");
  if (!container || !img) return;

  let timer = null;
  let startX = 0, startY = 0;
  let longPressFired = false;
  let suppressNextClick = false;

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const down = (x, y) => {
    if (_photoPreview) return; // já tem um aberto (ex.: multi-touch) — ignora
    startX = x; startY = y; longPressFired = false;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      longPressFired = true;
      suppressNextClick = true;
      openProfilePhotoPreview(img);
    }, LONG_PRESS_MS);
  };

  const move = (x, y) => {
    const dx = Math.abs(x - startX), dy = Math.abs(y - startY);
    if (timer && (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE)) {
      clearTimer(); // moveu antes de confirmar o long press — vira scroll normal, não abre
      return;
    }
    if (longPressFired && (dx > LONG_PRESS_DRAG_CANCEL || dy > LONG_PRESS_DRAG_CANCEL)) {
      closeProfilePhotoPreview(); // arrastou pra fora enquanto aberto — cancela
      longPressFired = false;
    }
  };

  const up = () => {
    clearTimer();
    if (longPressFired) { closeProfilePhotoPreview(); longPressFired = false; }
  };

  container.addEventListener("touchstart", (e) => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
  container.addEventListener("touchmove",  (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
  container.addEventListener("touchend", up);
  container.addEventListener("touchcancel", up);

  // desktop (mouse) — mesmo fluxo, pra funcionar em preview/desktop também
  container.addEventListener("mousedown", (e) => down(e.clientX, e.clientY));
  container.addEventListener("mousemove", (e) => { if (timer || longPressFired) move(e.clientX, e.clientY); });
  container.addEventListener("mouseup", up);
  container.addEventListener("mouseleave", up);

  container.addEventListener("click", (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
    onTap?.();
  });
}

function openProfilePhotoPreview(sourceImg) {
  if (_photoPreview) return;

  const rect = sourceImg.getBoundingClientRect();
  const src = sourceImg.currentSrc || sourceImg.src;

  const overlay = document.createElement("div");
  overlay.className = "photoPreviewOverlay";
  overlay.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  const vw = window.innerWidth, vh = window.innerHeight;
  const targetScale = Math.min(3.6, Math.max(3, (Math.min(vw, vh) * 0.8) / rect.width));
  const targetSize = rect.width * targetScale;

  // a caixa da imagem já nasce no tamanho final (alta resolução) — o estado
  // "pequeno" do início é só um transform visual, nunca um raster pequeno
  // esticado pra cima (que é o que causava o borrão).
  const finalLeft = (vw - targetSize) / 2;
  const finalTop  = (vh - targetSize) / 2;

  const clone = document.createElement("img");
  clone.className = "photoPreviewImg";
  clone.src = src;
  clone.style.width  = targetSize + "px";
  clone.style.height = targetSize + "px";
  clone.style.left   = finalLeft + "px";
  clone.style.top    = finalTop + "px";

  const shrinkRatio = rect.width / targetSize;
  const dx = (rect.left + rect.width / 2) - (finalLeft + targetSize / 2);
  const dy = (rect.top + rect.height / 2) - (finalTop + targetSize / 2);
  const initialTransform = `translate(${dx}px, ${dy}px) scale(${shrinkRatio})`;
  clone.style.transform = initialTransform;

  overlay.appendChild(clone);
  document.body.appendChild(overlay);
  _photoPreview = { overlay, clone, initialTransform };

  void clone.offsetWidth; // força o browser a pintar o estado inicial antes de animar (FLIP)

  requestAnimationFrame(() => {
    overlay.classList.add("photoPreviewOverlay-visible");
    clone.style.transform = "translate(0, 0) scale(1)";
  });
}

function closeProfilePhotoPreview() {
  const active = _photoPreview;
  if (!active) return;
  _photoPreview = null;

  const { overlay, clone, initialTransform } = active;
  overlay.classList.remove("photoPreviewOverlay-visible");
  clone.style.transform = initialTransform;

  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
  setTimeout(() => overlay.remove(), 320); // rede de segurança caso transitionend não dispare
}

// ==================== CLUSTER/HISTORY HELPERS ====================
function getFlowTypes() { return new Set(["msg","video","photo","cta","mediaGrid","audio"]); }

function updatePreviousGroupForNewMessage(side) {
  const flowTypes = getFlowTypes();
  for (let i = state.history.length - 1; i >= 0; i--) {
    const item = state.history[i];
    if (!item || item.side !== side) break;
    if (!flowTypes.has(item.type)) break;
    if (item.cluster === "single") item.cluster = "first";
    else if (item.cluster === "last") item.cluster = "middle";
    break;
  }
}

function getNewCluster(side) {
  const flowTypes = getFlowTypes();
  const last = state.history[state.history.length - 1];
  if (!last || last.side !== side || !flowTypes.has(last.type)) return "single";
  return "last";
}

function rebuildClusters() {
  const flowTypes = getFlowTypes();
  for (let i = 0; i < state.history.length; i++) {
    const item = state.history[i];
    if (!item || !flowTypes.has(item.type)) continue;
    const prev = state.history[i - 1];
    const next = state.history[i + 1];
    const samePrev = !!prev && flowTypes.has(prev.type) && prev.side === item.side;
    const sameNext = !!next && flowTypes.has(next.type) && next.side === item.side;
    if (!samePrev && !sameNext) item.cluster = "single";
    else if (!samePrev && sameNext) item.cluster = "first";
    else if (samePrev && sameNext) item.cluster = "middle";
    else item.cluster = "last";
  }
}

function getDefaultGridItems() {
  return [
    { src: ASSETS.media1, duration: "0:08" },
    { src: ASSETS.media2, duration: "0:12" },
    { src: ASSETS.media3, duration: "0:21" },
    { src: ASSETS.media4, duration: "0:27" },
  ];
}

function getDefaultWaveBars() {
  return [18,30,42,37,28,24,32,48,26,20,14,12,16,18,26,34,46,41,29,18,14,20,28,39,22,18,13,16,21,30,26,22];
}

// ==================== LOADING SCREEN (conexão premium) ====================
// Componentes: BackgroundVideo, ParticleSystem, ConnectionHUD, ProgressController.
// Um único timeline de progresso (rAF) dirige a barra, o anel e a revelação dos
// status — nada de setTimeouts encadeados pra sincronizar animação. Timers só
// na sequência final de saída (fade/blur), igual ao resto do app.

// Sons sintetizados via Web Audio API — sem arquivo, sem licenciamento,
// combina com a estética digital/neon da tela. Falha silenciosa se o
// engine bloquear áudio antes de um gesto do usuário (comum antes do
// toque em "Entrar no Chat"); nunca trava a experiência.
let _lsAudioCtx = null;
function lsGetAudioCtx() {
  if (_lsAudioCtx) return _lsAudioCtx;
  try { _lsAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch { _lsAudioCtx = null; }
  return _lsAudioCtx;
}

function lsPlayTick() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(920, now);
  osc.frequency.exponentialRampToValueAtTime(1400, now + 0.07);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

function lsPlaySuccessChime() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [660, 990].forEach((freq, i) => {
    const t = now + i * 0.1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.34);
  });
}

// clique mecânico da roleta — mais percussivo que lsPlayTick (que é um blip
// suave pra revelar itens de checklist), pra soar como a divisória de uma
// fatia passando pelo ponteiro.
function lsPlaySpinTick() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1200, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.10, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

// arpejo ascendente de 4 notas — o "grande momento" da roleta, mais festivo
// que o chime de duas notas da tela de conexão.
function lsPlayWinFanfare() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [523, 659, 784, 1046].forEach((freq, i) => {
    const t = now + i * 0.09;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

// duas notas curtas e descendentes — som de "quase..." (1ª tentativa,
// sem prêmio), deliberadamente mais discreto/menos dramático que uma
// derrota "de verdade", já que o usuário ainda tem a 2ª chance garantida.
function rwPlayLossThud() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [392, 293].forEach((freq, i) => {
    const t = now + i * 0.13;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

// "whoosh" grave e descendente — usado quando as cortinas abrem.
function esPlayWhoosh() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(70, now + 0.6);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.7);
}

// shimmer ascendente e sutil — usado no momento em que a silhueta revela
// (contraponto ao whoosh descendente das cortinas: aqui o som "sobe" junto
// com o rim-light aparecendo).
function esPlayRevealShimmer() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.9);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 1.05);
}

// "pop" de 2 notas subindo — estilo notificação de mensagem do WhatsApp,
// curto e discreto. Só toca pra mensagens que chegam (lado esquerdo, dela);
// mensagens que o próprio lead manda não tocam esse som, igual o WhatsApp.
function waPlayMessagePop() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [587, 784].forEach((freq, i) => {
    const t = now + i * 0.055;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  });
}

// 2 notas descendo — tom de "chamada encerrada", eco do padrão universal de
// tom de desligar (oposto do waPlayMessagePop, que sobe).
function callPlayEndTone() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [600, 400].forEach((freq, i) => {
    const t = now + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.34);
  });
}

// 2 notas suaves e sustentadas — toque de chamada estilo WhatsApp
// ("brrring... brrring..."), sintetizado (sem arquivo de áudio). Uma
// instância = um "ring" duplo; quem chama repete no mesmo ciclo da
// vibração (ver showIncomingCall).
function waPlayCallRingTone() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [480, 600].forEach((freq, i) => {
    const t = now + i * 0.5;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.47);
  });
}

// arpejo curto de 3 notas subindo — toca uma vez ao aceitar a chamada
// (efeito de "você entrou"), distinto do toque de chamando e do pop de
// mensagem.
function waPlayCallConnected() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  [523, 659, 880].forEach((freq, i) => {
    const t = now + i * 0.06;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}

// drone ambiente grave e contínuo (2 osciladores levemente desafinados) —
// tocado durante toda a tela de entrada. start()/stop() controlam o fade.
function esStartAmbientDrone() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 1.2);
  gain.connect(ctx.destination);

  const oscs = [55, 58].map((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start();
    return osc;
  });

  return function stop() {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    setTimeout(() => oscs.forEach((o) => { try { o.stop(); } catch {} }), 600);
  };
}

// pulso suave tipo radar/sonar — tocado durante a espera da tela preta inicial
function lsPlayLoadingPulse() {
  const ctx = lsGetAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.6);
}

const LS_STATUS_ITEMS = [
  { icon: "shield", label: "Conexão criptografada" },
  { icon: "server", label: "Servidor disponível" },
  { icon: "sync",   label: "Sincronizando mensagens" },
  { icon: "bolt",   label: "Estabelecendo conexão segura" },
  { icon: "live",   label: "Preparando chat ao vivo" },
];

function lsIcon(name) {
  const icons = {
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    server: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/><circle cx="7" cy="7" r=".9" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r=".9" fill="currentColor" stroke="none"/></svg>`,
    bolt: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>`,
    sync: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>`,
    live: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M7 9a7 7 0 0 0 0 6M17 9a7 7 0 0 1 0 6" stroke-linecap="round"/></svg>`,
  };
  return icons[name] || "";
}

// Layer 1 — vídeo de fundo em tela cheia, toca uma única vez e congela no
// último frame (a verificação é sincronizada com a duração real dele).
function mountBackgroundVideo(host, src) {
  // reaproveita o <video> que já vem baixando desde preloadMedia() (boot do
  // app) — zero delay, em vez de criar um elemento novo que começa do zero.
  const preloaded = document.getElementById("lsPreloadVideo");
  let video;
  if (preloaded && preloaded.getAttribute("src") === src) {
    video = preloaded;
    video.removeAttribute("id");
    video.style.cssText = "";
  } else {
    video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
  }
  video.className = "lsVideo";
  // bot1: vídeo toca uma vez e congela no último frame, como se fosse foto
  // (pedido assim de propósito). bot2 (persona=m2): roda em loop até a
  // verificação terminar e o botão de brinde aparecer.
  video.loop = PERSONA === "m2";
  host.appendChild(video); // appendChild move o elemento se já estava no body
  video.play().catch(() => {});
  return video;
}

// Layer 3 — partículas discretas subindo devagar (canvas, rAF próprio).
// `colors` é uma lista de [r,g,b] — cada partícula sorteia uma na hora de
// nascer; default branco (comportamento original, usado pelas telas de
// loading/roleta). A tela de entrada passa tons vermelho/dourado (brasa).
function mountParticleSystem(host, colors = [[255, 255, 255]]) {
  const canvas = document.createElement("canvas");
  canvas.className = "lsParticles";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = 0, h = 0, particles = [];
  let rafId = null, running = true;

  function resize() {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(n) {
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 0.6 + Math.random() * 1.5,
      vy: -(0.08 + Math.random() * 0.16),
      vx: (Math.random() - 0.5) * 0.05,
      a: 0.12 + Math.random() * 0.3,
      c: colors[(Math.random() * colors.length) | 0],
    }));
  }

  resize();
  spawn(36);
  window.addEventListener("resize", resize);

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
      if (p.x < -4) p.x = w + 4;
      if (p.x > w + 4) p.x = -4;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    },
  };
}

// Layers 4-7 — vidro fosco + anel neon + texto + lista de status + barra.
// Todo o conteúdo de verificação fica em .lsHudContent pra poder sumir sozinho
// no fim, sem levar o vídeo (que continua visível) nem o anel/botão final junto.
function mountConnectionHUD(host) {
  const RADIUS = 52;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  host.insertAdjacentHTML("beforeend", `
    <div class="lsHud">
      <div class="lsHudContent" id="lsHudContent">
        <div class="lsRingWrap">
          <div class="lsRingGlow"></div>
          <svg class="lsRingSvg" viewBox="0 0 120 120">
            <defs>
              <linearGradient id="lsRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ff2fb0"/>
                <stop offset="55%" stop-color="#8b5cf6"/>
                <stop offset="100%" stop-color="#3ec8ff"/>
              </linearGradient>
            </defs>
            <circle class="lsRingTrack" cx="60" cy="60" r="${RADIUS}"></circle>
            <circle class="lsRingProgress" id="lsRingProgress" cx="60" cy="60" r="${RADIUS}"
              stroke="url(#lsRingGrad)" stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="${CIRCUMFERENCE}"></circle>
          </svg>
          <div class="lsRingCenter">${lsIcon("shield")}</div>
        </div>

        <div class="lsTitle">Verificando conexão segura...</div>
        <div class="lsSubtitle">Preparando acesso ao chat ao vivo...</div>

        <div class="lsStatusList">
          ${LS_STATUS_ITEMS.map((item) => `
            <div class="lsStatusItem">
              <span class="lsStatusIcon">${lsIcon(item.icon)}</span>
              <span class="lsStatusLabel">${item.label}</span>
              <span class="lsStatusCheck">✓</span>
            </div>
          `).join("")}
        </div>

        <div class="lsProgressWrap">
          <div class="lsProgressBar"><div class="lsProgressFill" id="lsProgressFill"></div></div>
          <div class="lsProgressLabel" id="lsProgressLabel">Conectando...</div>
        </div>
      </div>
    </div>
  `);

  const hudEl     = host.querySelector(".lsHud");
  const contentEl = document.getElementById("lsHudContent");
  const ring      = document.getElementById("lsRingProgress");
  const fill      = document.getElementById("lsProgressFill");
  const label     = document.getElementById("lsProgressLabel");
  const items     = Array.from(host.querySelectorAll(".lsStatusItem"));

  return {
    setProgress(p) {
      ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - p));
      fill.style.transform = `scaleX(${p})`;
    },
    revealUpTo(count) {
      items.forEach((el, i) => el.classList.toggle("lsStatusItem-visible", i < count));
    },
    setLabel(text) { label.textContent = text; },
    hideContent() {
      contentEl.classList.add("lsHudContent-hidden");
      contentEl.addEventListener("transitionend", () => contentEl.remove(), { once: true });
      setTimeout(() => contentEl.remove(), 500); // rede de segurança
    },
    mountEnterButton(onTap) {
      const btn = document.createElement("button");
      btn.className = "lsEnterBtn";
      btn.type = "button";
      btn.textContent = "👉 CLIQUE AQUI: BRINDE PRÊMIO GRÁTIS 😈";
      hudEl.appendChild(btn);
      requestAnimationFrame(() => btn.classList.add("lsEnterBtn-visible"));
      btn.addEventListener("click", onTap, { once: true });
    },
  };
}

// Tela de carregamento inicial, antes da verificação segura — puro
// preto + spinner por ~3s, depois um fade antes de revelar a tela de
// verificação. Timing fixo, coreografado por nós.
function runInitialLoadingScreen() {
  trackEvent("MINIAPP_LOADING_SCREEN");
  return new Promise((resolve) => {
    const screen = document.createElement("div");
    screen.className = "lsScreen";
    screen.style.background = "#000";
    app.appendChild(screen);

    const spinner = document.createElement("div");
    spinner.className = "lsLoaderSpinner";
    screen.appendChild(spinner);

    requestAnimationFrame(() => screen.classList.add("lsScreen-visible"));
    lsPlayLoadingPulse();
    setTimeout(lsPlayLoadingPulse, 1500);

    // Saída simples: só um fade (mantém o som de confirmação, sem
    // shockwave/iris).
    setTimeout(() => {
      lsPlaySuccessChime();
      screen.classList.remove("lsScreen-visible");
      screen.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 500); // rede de segurança caso transitionend não dispare
    }, 2000);

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      screen.remove();
      resolve();
    }
  });
}

// Orquestrador — a verificação e o vídeo terminam juntos (progresso vem do
// currentTime/duration real do vídeo, não de um cronômetro paralelo). Ao
// concluir, o HUD some e o vídeo fica congelado no último frame até o
// usuário tocar em "Entrar no Chat" — só aí a Promise resolve.
function runConnectionLoadingScreen() {
  trackEvent("MINIAPP_CONNECTION_SCREEN");
  return new Promise((resolve) => {
    // Duração fixa da verificação, independente do vídeo usado como fundo —
    // vídeos mais curtos que isso (ex.: 4s) simplesmente terminam e ficam
    // parados no último frame, como se fosse uma foto, enquanto o HUD
    // continua no mesmo ritmo de sempre até completar.
    const VERIFY_DURATION = 15000;

    const screen = document.createElement("div");
    screen.className = "lsScreen";
    app.appendChild(screen);
    screen.appendChild(Object.assign(document.createElement("div"), { className: "lsOverlay" }));

    const video = mountBackgroundVideo(screen, ASSETS.privateIntro);
    const particles = mountParticleSystem(screen);
    const hud = mountConnectionHUD(screen);

    requestAnimationFrame(() => screen.classList.add("lsScreen-visible"));

    let revealed = 0;
    let rafId = null;
    let verified = false;
    let startedAt = null;

    function computeProgress(now) {
      if (startedAt === null) startedAt = now;
      return Math.min(1, (now - startedAt) / VERIFY_DURATION);
    }

    function frame(now) {
      if (verified) return;
      const p = computeProgress(now);
      hud.setProgress(p);

      const shouldReveal = Math.min(LS_STATUS_ITEMS.length, Math.floor(p * LS_STATUS_ITEMS.length) + 1);
      if (shouldReveal > revealed) { revealed = shouldReveal; hud.revealUpTo(revealed); lsPlayTick(); }

      if (p >= 1) { onVerified(); return; }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    // Sem listener de "ended" — o vídeo pode ser mais curto que
    // VERIFY_DURATION e simplesmente fica parado no último frame (loop=false
    // já garante isso) enquanto o HUD continua no tempo fixo. Só erro real
    // de carregamento encerra a verificação antes da hora.
    video.addEventListener("error", onVerified); // não trava a experiência se o vídeo falhar

    function onVerified() {
      if (verified) return;
      verified = true;
      if (rafId) cancelAnimationFrame(rafId);
      hud.setProgress(1);
      hud.revealUpTo(LS_STATUS_ITEMS.length);
      hud.setLabel("Conectado ✓");
      vibrate(14);
      lsPlaySuccessChime();

      // No lugar do vídeo parado no último frame, troca por uma foto fixa
      // no exato momento em que o botão DESBLOQUEAR PRÊMIOS aparece.
      video.pause();
      const photo = document.createElement("img");
      photo.className = "lsVideo";
      photo.src = ASSETS.connectionDonePhoto;
      // Só troca depois da foto estar de fato decodificada e pronta pra
      // pintar — trocar antes disso deixa um instante sem vídeo nem foto
      // (mostra o fundo por baixo, um "flash" preto).
      const swapIn = () => { if (!photo.isConnected) video.replaceWith(photo); };
      if (photo.decode) photo.decode().then(swapIn).catch(swapIn);
      else { photo.addEventListener("load", swapIn, { once: true }); photo.addEventListener("error", swapIn, { once: true }); }

      // HUD some — só o toque avança
      hud.hideContent();
      hud.mountEnterButton(onEnterTap);
    }

    // Saída simples: só um fade (remove .lsScreen-visible, reaproveitando a
    // mesma transição de opacidade já usada na entrada) — sem blackout/
    // spinner/shockwave/iris, mas mantém o som de confirmação.
    function onEnterTap() {
      trackEvent("MINIAPP_CONNECTION_ENTER_TAP");
      _tryUnlockEntranceAudio(); // clique real e direto — necessário pro destravamento funcionar de fato
      hapticImpact("medium");
      lsPlaySuccessChime();
      particles.stop();
      screen.classList.remove("lsScreen-visible");
      screen.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 500); // rede de segurança caso transitionend não dispare
    }

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      screen.remove();
      resolve();
    }
  });
}

// ==================== ROLETA PREMIUM (gateway pré-chat) ====================
// Nova etapa entre a verificação de conexão e o chat. Sempre resulta em
// vitória (é um gateway obrigatório, não uma aposta com risco real) — o
// suspense vem só da física do giro (aceleração/desaceleração/overshoot),
// nunca de um resultado que possa travar o funil numa tela de "perdeu".
// Canvas 2D (não SVG/CSS transform) pra rotação, um único loop rAF dirigido
// por tempo decorrido (mesma filosofia das telas de loading acima: nada de
// setTimeouts encadeados dirigindo a animação em si).

const RW_SEG_ANGLE_DEG = 45; // 360 / 8 segmentos
// 67.5° (em vez de 90°) — desloca o quadro estático em -22.5° (meia fatia)
// pra que, em repouso (rotationDeg=0), o ponteiro fique exatamente na
// divisória entre os segmentos 4 (❌ TENTE DE NOVO) e 5 (📹 VÍDEO), em vez
// de apontar pro centro do 4. Como computeRouletteTarget() usa essa mesma
// constante, o resultado final de qualquer giro não muda — só a pose de
// repouso antes de girar.
const RW_IDLE_OFFSET_DEG = 67.5;
const RW_POINTER_ANGLE_DEG = 270; // ponteiro fixo no topo
const RW_WIN_INDEX = 0;  // segmento dourado — 👑 PREMIUM
const RW_LOSE_INDEX = 4; // segmento vermelho — ❌ TENTE DE NOVO (1ª tentativa)

// Pilha de fonte pesada (800/900) — SF Pro Display no iOS/macOS via
// -apple-system (é literalmente o mesmo binário), Roboto/Segoe no
// Android/Windows. Evitamos carregar uma web font (Inter/Manrope/Outfit)
// de propósito: canvas não re-renderiza sozinho quando uma fonte remota
// termina de carregar, então o 1º frame (desenho estático, síncrono, no
// mount) sairia com a fonte de fallback — um risco real de "flash" que a
// pilha nativa não tem, com resultado visual equivalente.
const RW_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Cada prêmio com identidade própria: emoji + cor de destaque (glow/stroke)
// coerentes, sobre uma base bem escura em degradê (gradiente radial, nunca
// chapada) — paleta de pedras preciosas, sofisticada, não saturada/gritante.
const RW_SEGMENTS = [
  { emoji: "👑", label: "PREMIUM", gold: true,
    stops: [[0, "#f6ddaa"], [0.55, "#d6b07a"], [1, "#a97c3a"]] },
  { emoji: "💎", label: "VIP",
    stops: [[0, "#141a3a"], [1, "#070a1c"]], glow: "rgba(129,140,255,.5)" },
  { emoji: "🔥", label: "BÔNUS",
    stops: [[0, "#2c1206"], [1, "#160a04"]], glow: "rgba(255,138,46,.5)" },
  { emoji: "⭐", label: "SORTE",
    stops: [[0, "#2b1e06"], [1, "#160f02"]], glow: "rgba(255,210,63,.5)" },
  // "sem prêmio" — vermelho vivo + brilho pulsante (ver pulseGlow/pulse
  // abaixo) pra destacar visualmente que essa fatia não dá acesso.
  { emoji: "❌", label: "TENTE DE\nNOVO",
    stops: [[0, "#e53935"], [1, "#5c0f0f"]],
    pulse: true, pulseGlow: { r: 255, g: 80, b: 70, aMin: 0.22, aMax: 0.65 } },
  { emoji: "📹", label: "VÍDEO",
    stops: [[0, "#2c0d12"], [1, "#170609"]], glow: "rgba(230,57,80,.5)" },
  { emoji: "❤️", label: "ESPECIAL",
    stops: [[0, "#330a17"], [1, "#1c060c"]], glow: "rgba(255,64,110,.55)" },
  { emoji: "✨", label: "EXTRA",
    stops: [[0, "#1d1236"], [1, "#0f0a1c"]], glow: "rgba(167,139,250,.5)" },
];

// Ângulo final de rotação pra travar o ponteiro exatamente no segmento
// `targetIndex` pedido. Isolado da renderização pra ser fácil de ajustar/
// testar; genérico o bastante pra mirar tanto a derrota (1ª tentativa)
// quanto a vitória (2ª tentativa).
function computeRouletteTarget(targetIndex) {
  const targetMod = ((RW_POINTER_ANGLE_DEG - RW_IDLE_OFFSET_DEG - targetIndex * RW_SEG_ANGLE_DEG) % 360 + 360) % 360;
  const fullSpins = 6;
  // jitter fica sempre a pelo menos 50% da meia-largura do segmento de
  // qualquer borda — nunca fica visualmente ambíguo qual fatia "ganhou".
  const jitter = (Math.random() * 2 - 1) * (RW_SEG_ANGLE_DEG * 0.25);
  return fullSpins * 360 + targetMod + jitter;
}

// 4 fontes pré-computadas (emoji/label × dourado/decoy) por tamanho de tela —
// evita montar a string de font e reatribuir ctx.font a cada frame. Pesos
// 800/900 apenas — "nada abaixo disso".
// `goldScale` (default 1) reduz só o emoji+rótulo do segmento dourado,
// mantendo peso/fonte/proporção entre os dois — usado pela roleta de
// desconto (0.75, ~25% menor) sem afetar a roleta original (fica em 1).
function buildRouletteFonts(r, goldScale = 1) {
  const mk = (px, weight) => ({ str: `${weight} ${px}px ${RW_FONT_STACK}`, px });
  return {
    goldEmoji: mk(Math.max(22, r * 0.19) * goldScale, 900),
    goldLabel: mk(Math.max(14, r * 0.10) * goldScale, 900),
    decoyEmoji: mk(Math.max(20, r * 0.17), 900),
    decoyLabel: mk(Math.max(13, r * 0.092), 900),
  };
}

// Desenho puro — chamado tanto no mount (estático) quanto a cada frame do
// giro. fillStyles/fonts são pré-computados fora do loop (nada de gradientes
// ou strings de font sendo recriadas por frame).
//
// Texto TANGENCIAL (perpendicular ao raio, acompanhando a circunferência) em
// vez de radial: com o ponteiro fixo no topo e o segmento vencedor sempre
// parando ali, texto tangencial fica perfeitamente na horizontal exatamente
// no momento em que o resultado é revelado — texto radial ficaria de lado
// (girado 90°) nesse exato momento.
//
// Hierarquia em 2 linhas (emoji em cima, rótulo embaixo) — nunca "emoji +
// texto" espremidos numa linha só. O "glow" é falso (nunca ctx.shadowBlur,
// que é caro e derrubaria o rAF em Android fraco): 2 traços por baixo do
// preenchimento — um grosso e colorido (halo) + um fino e escuro (contraste)
// — mesmo custo de um strokeText a mais, sem o custo real de um blur.
// `segments` é o array de fatias (dados, não hardcoded) — permite
// reaproveitar essa mesma função de desenho pra qualquer roleta (ex.: a de
// desconto, ver DISCOUNT_SEGMENTS/runDiscountRouletteScreen), sem duplicar
// nenhuma linha de código de renderização.
// `pulseAlpha` (0..1, opcional) só afeta segmentos com `pulse:true` (hoje,
// só o "TENTE DE NOVO") — modula a intensidade do halo colorido dele entre
// pulseGlow.aMin/aMax. Todos os outros segmentos ignoram esse parâmetro e
// renderizam exatamente como antes.
function drawWheel(ctx, size, rotationDeg, fillStyles, fonts, pulseAlpha, segments) {
  if (!size) return;
  const r = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(r, r);
  ctx.rotate(rotationDeg * Math.PI / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  segments.forEach((seg, i) => {
    const startDeg = RW_IDLE_OFFSET_DEG + i * RW_SEG_ANGLE_DEG - RW_SEG_ANGLE_DEG / 2;
    const startRad = startDeg * Math.PI / 180;
    const endRad = startRad + (RW_SEG_ANGLE_DEG * Math.PI / 180);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 3, startRad, endRad);
    ctx.closePath();
    ctx.fillStyle = fillStyles[i] || "#171310";
    ctx.fill();
    ctx.strokeStyle = seg.gold ? "rgba(246,221,170,.55)" : "rgba(214,176,122,.18)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const midRad = (startRad + endRad) / 2;
    ctx.save();
    ctx.rotate(midRad + Math.PI / 2); // +90° = tangencial em vez de radial

    const emojiFont = seg.gold ? fonts.goldEmoji : fonts.decoyEmoji;
    const labelFont = seg.gold ? fonts.goldLabel : fonts.decoyLabel;
    const emojiY = -(r - 24);
    const labelLines = seg.label.split("\n");
    const lineGap = labelFont.px * 1.08;
    const labelY0 = emojiY + emojiFont.px * 0.95;

    // linha 1 — emoji (cor é intrínseca ao glifo; sem stroke/shadow/letter-
    // spacing — alguns emojis são 2 code points, ex. ❤️ = coração + variation
    // selector, e letter-spacing entre eles quebraria a renderização colorida).
    ctx.font = emojiFont.str;
    ctx.fillStyle = "#fff";
    ctx.fillText(seg.emoji, 0, emojiY);

    // linha(s) seguintes — rótulo (pode quebrar em 2 linhas via "\n" no
    // texto, mesmo tamanho/peso de fonte, só empilhado), halo colorido +
    // contraste escuro (glow falso).
    ctx.letterSpacing = "0.4px"; // ignorado silenciosamente onde não suportado
    ctx.font = labelFont.str;

    let glowColor = seg.glow;
    if (seg.pulse && seg.pulseGlow) {
      const t = pulseAlpha ?? 1;
      const a = seg.pulseGlow.aMin + (seg.pulseGlow.aMax - seg.pulseGlow.aMin) * t;
      glowColor = `rgba(${seg.pulseGlow.r},${seg.pulseGlow.g},${seg.pulseGlow.b},${a})`;
    }

    labelLines.forEach((line, li) => {
      const labelY = labelY0 + li * lineGap;
      if (!seg.gold) {
        // halo bem sutil — grosso demais preenche o miolo das letras
        // pequenas e "lava" o texto em vez de dar um glow leve.
        ctx.lineWidth = labelFont.px * 0.26;
        ctx.strokeStyle = glowColor;
        ctx.strokeText(line, 0, labelY);
      }
      ctx.lineWidth = Math.max(1.5, labelFont.px * 0.16);
      ctx.strokeStyle = seg.gold ? "rgba(58,38,10,.5)" : "rgba(2,2,4,.7)";
      ctx.strokeText(line, 0, labelY);
      ctx.fillStyle = seg.gold ? "#2a1c08" : "#fbf7ef";
      ctx.fillText(line, 0, labelY);
    });
    ctx.restore();
  });

  ctx.restore();
}

// Timeline única em rAF: aceleração (easeOutQuart) até um overshoot além do
// alvo, depois um cosseno amortecido que converge exatamente no alvo — sem
// snap manual no fim. Tempo decorrido via performance.now(), então uma aba
// jogada pro background não gera drift (só "pula" pra frente ao voltar).
//
// `suspense` (opcional, default false/undefined) liga um perfil alternativo
// só pro trecho final — usado apenas pela roleta de desconto, pra dar a
// sensação de "quase caiu no prêmio anterior". Quando omitido, o código
// roda exatamente pelo branch de sempre (linha por linha idêntico ao antes),
// então a roleta original não é afetada em nada por essa opção existir.
function spinWheel(draw, finalRotationDeg, onTick, suspense) {
  const T_SPIN = 4100;
  const OVERSHOOT_DEG = 18;
  const overshootRotation = finalRotationDeg + OVERSHOOT_DEG;

  // Fases do modo suspense (só calculadas se pedido): decelera quase até
  // parar um pouco ANTES da divisória com o segmento anterior, atravessa
  // essa divisória bem devagar (400-700ms — aqui 550+550ms de arrasto e
  // acomodação), depois avança o resto até o centro do vencedor com um
  // pequeno overshoot proporcional + acomodação amortecida (mesmo espírito
  // do branch normal, só que numa janela de tempo/distância bem menor).
  // Duração total do giro (T_SPIN) não muda em nenhum dos dois modos.
  let preBoundary, postBoundary, phaseATime, phaseBTime, phaseCTime;
  if (suspense) {
    const boundaryR = finalRotationDeg - RW_SEG_ANGLE_DEG / 2;
    preBoundary = boundaryR - RW_SEG_ANGLE_DEG * 0.05;  // ainda dentro do segmento anterior, quase na borda
    postBoundary = boundaryR + RW_SEG_ANGLE_DEG * 0.15; // já um pouco dentro do segmento vencedor
    phaseBTime = 550; // dentro do pedido de 400-700ms
    phaseCTime = 550;
    phaseATime = T_SPIN - phaseBTime - phaseCTime;
  }

  let rafId = null;
  let cancelled = false;
  let lastSeg = null;

  const promise = new Promise((resolve) => {
    const t0 = performance.now();

    function frame(now) {
      if (cancelled) return;
      const elapsed = now - t0;
      const p = Math.min(1, elapsed / T_SPIN);
      let rotation;

      if (suspense) {
        if (elapsed < phaseATime) {
          // fase A — igual ao giro normal (easeOutQuart), só que o alvo
          // aqui é "quase a borda" em vez do overshoot de sempre.
          const q = elapsed / phaseATime;
          const eased = 1 - Math.pow(1 - q, 4);
          rotation = eased * preBoundary;
        } else if (elapsed < phaseATime + phaseBTime) {
          // fase B — o suspense em si: atravessa a divisória bem devagar,
          // com velocidade zero nas duas pontas (sem "trancos").
          const q = (elapsed - phaseATime) / phaseBTime;
          const eased = q - Math.sin(2 * Math.PI * q) / (2 * Math.PI);
          rotation = preBoundary + eased * (postBoundary - preBoundary);
        } else {
          // fase C — avança o resto até o vencedor: pequeno overshoot
          // proporcional à distância restante + acomodação amortecida.
          const q = Math.min(1, (elapsed - phaseATime - phaseBTime) / phaseCTime);
          const localOvershoot = postBoundary + (finalRotationDeg - postBoundary) * 1.12;
          if (q < 0.6) {
            const qq = q / 0.6;
            const eased = 1 - Math.pow(1 - qq, 3);
            rotation = postBoundary + eased * (localOvershoot - postBoundary);
          } else {
            const qq = (q - 0.6) / 0.4;
            const decay = Math.pow(1 - qq, 2);
            const osc = Math.cos(qq * 1.6 * Math.PI) * (localOvershoot - finalRotationDeg) * decay;
            rotation = finalRotationDeg + osc;
          }
        }
      } else if (p < 0.75) {
        const q = p / 0.75;
        const eased = 1 - Math.pow(1 - q, 4); // easeOutQuart
        rotation = eased * overshootRotation;
      } else {
        const q = (p - 0.75) / 0.25;
        const decay = Math.pow(1 - q, 2);
        const osc = Math.cos(q * 2.2 * Math.PI) * (overshootRotation - finalRotationDeg) * decay;
        rotation = finalRotationDeg + osc;
      }

      draw(rotation);

      const segIndex = Math.floor(rotation / RW_SEG_ANGLE_DEG);
      if (segIndex !== lastSeg) {
        lastSeg = segIndex;
        onTick?.();
      }

      if (p < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        draw(finalRotationDeg); // garante o valor exato, sem erro de ponto flutuante
        resolve();
      }
    }
    rafId = requestAnimationFrame(frame);
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}

// Monta o wrap/glow/canvas/ponteiro/hub e devolve os controles do giro.
// DPR-aware, resize só recalcula fora do loop de animação (mesmo padrão de
// mountParticleSystem). `segments` é o array de fatias — mesmo componente
// reaproveitado por qualquer roleta (ver drawWheel).
function mountRouletteWheel(host, segments, goldScale = 1) {
  host.insertAdjacentHTML("beforeend", `
    <div class="rwWheelWrap">
      <div class="rwGlow"></div>
      <canvas class="rwCanvas"></canvas>
      <div class="rwPointer"></div>
      <div class="rwHub"></div>
    </div>
  `);

  const wrap = host.querySelector(".rwWheelWrap");
  const canvas = wrap.querySelector(".rwCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const hasPulseSegment = segments.some((s) => s.pulse); // só a roleta original tem (❌ TENTE DE NOVO)

  let size = 0;
  let fillStyles = [];
  let fonts = null;
  let currentRotation = 0;
  let activeCancel = null;

  // Gradiente radial próprio por segmento (nunca cor chapada) — radial
  // centrado em (0,0) é rotation-invariant, então não "derrapa" durante o giro.
  function buildFillStyles() {
    fillStyles = segments.map((seg) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
      seg.stops.forEach(([offset, color]) => g.addColorStop(offset, color));
      return g;
    });
  }

  function draw(rotationDeg, pulseAlpha) {
    currentRotation = rotationDeg;
    drawWheel(ctx, size, rotationDeg, fillStyles, fonts, pulseAlpha, segments);
  }

  function resize() {
    size = wrap.clientWidth;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildFillStyles();
    fonts = buildRouletteFonts(size / 2, goldScale);
    draw(currentRotation);
  }

  resize();
  window.addEventListener("resize", resize);

  // Pulso de brilho do segmento "TENTE DE NOVO" — contido (~6s, alguns
  // ciclos suaves) e não um loop pra sempre: some assim que o usuário toca
  // GIRAR, e mesmo se ele nunca tocar, se estabiliza sozinho no brilho máximo
  // depois de alguns ciclos (não fica consumindo rAF indefinidamente). Só
  // roda se algum segmento realmente tiver `pulse:true` — roletas sem
  // nenhum segmento pulsante (ex.: a de desconto) nem iniciam o loop.
  let idlePulseRaf = null;
  function startIdlePulse() {
    if (!hasPulseSegment) return;
    const t0 = performance.now();
    const DURATION = 6000;
    function frame(now) {
      const elapsed = now - t0;
      if (elapsed >= DURATION) { draw(currentRotation, 1); idlePulseRaf = null; return; }
      const phase = (Math.sin(elapsed / 900) + 1) / 2; // 0..1, ciclo lento (~5.7s)
      draw(currentRotation, phase);
      idlePulseRaf = requestAnimationFrame(frame);
    }
    idlePulseRaf = requestAnimationFrame(frame);
  }
  function stopIdlePulse() {
    if (idlePulseRaf) { cancelAnimationFrame(idlePulseRaf); idlePulseRaf = null; }
  }
  startIdlePulse();

  return {
    spin(finalRotationDeg, onTick, suspense) {
      stopIdlePulse();
      const { promise, cancel } = spinWheel(draw, finalRotationDeg, onTick, suspense);
      activeCancel = cancel;
      return promise.finally(() => { activeCancel = null; });
    },
    destroy() {
      stopIdlePulse();
      if (activeCancel) activeCancel();
      window.removeEventListener("resize", resize);
    },
  };
}

// Confete one-shot: canvas próprio, física simples de gravidade+rotação,
// auto-remove depois de ~1.2s (não fica dependurado se o usuário tocar
// direto em ENTRAR NO CHAT).
function mountConfettiBurst(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "rwConfetti";
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ["#d6b07a", "#f4d9a8", "#b56a7c", "#ffffff"];
  const pieces = Array.from({ length: 26 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 60,
    y: H * 0.38,
    vx: (Math.random() - 0.5) * 7,
    vy: -(4 + Math.random() * 5),
    w: 5 + Math.random() * 4,
    h: 8 + Math.random() * 6,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const GRAVITY = 0.22;
  const DURATION = 1200;
  const t0 = performance.now();
  let rafId = null;
  let stopped = false;

  function frame(now) {
    if (stopped) return;
    const elapsed = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of pieces) {
      p.vy += GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const fade = Math.max(0, 1 - elapsed / DURATION);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < DURATION) {
      rafId = requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      canvas.remove();
    },
  };
}

// Orquestrador — mesmo formato de runConnectionLoadingScreen (Promise que
// resolve quando a tela termina sua própria saída). Reaproveita
// mountParticleSystem verbatim; a saída é só um fade + som de confirmação.
function runRouletteScreen() {
  trackEvent("MINIAPP_ROULETTE_SCREEN");
  return new Promise((resolve) => {
    const screen = document.createElement("div");
    screen.className = "lsScreen";
    app.appendChild(screen);
    screen.insertAdjacentHTML("beforeend", `<div class="rwBg"></div>`);

    const particles = mountParticleSystem(screen);

    screen.insertAdjacentHTML("beforeend", `
      <div class="rwStage">
        <div class="rwTitle">GIRE E DESBLOQUEI ALGO MEU EXCLUSIVO 😈</div>
        <div class="rwSubtitle">Toque em GIRAR pra testar sua sorte</div>
      </div>
    `);
    const stage = screen.querySelector(".rwStage");
    const wheel = mountRouletteWheel(stage, RW_SEGMENTS);

    stage.insertAdjacentHTML("beforeend", `
      <div class="rwActionArea">
        <button type="button" class="rwSpinBtn">GIRAR 🎰</button>
      </div>
    `);
    const actionArea = stage.querySelector(".rwActionArea");
    const spinBtn = actionArea.querySelector(".rwSpinBtn");

    requestAnimationFrame(() => {
      screen.classList.add("lsScreen-visible");
      spinBtn.classList.add("rwSpinBtn-visible");
    });

    let confetti = null;

    // Giro compartilhado pelas duas tentativas — só muda o índice-alvo e o
    // callback de conclusão. Nada na física/tick/haptic do giro em si muda
    // entre a 1ª e a 2ª tentativa.
    function runSpin(targetIndex, onDone) {
      stage.querySelector(".rwGlow")?.classList.add("rwGlow-spinning");
      hapticImpact("medium");

      const finalRotation = computeRouletteTarget(targetIndex);
      let lastTickAt = 0;
      wheel.spin(finalRotation, () => {
        // no início do giro várias divisórias passam por frame (~3000°/s) —
        // sem essa trava o tick soaria como um zumbido em vez de cliques
        // distintos. O desenho em si não é afetado, só o som/haptic.
        const t = performance.now();
        if (t - lastTickAt < 40) return;
        lastTickAt = t;
        lsPlaySpinTick();
        hapticImpact("light");
      }).then(onDone);
    }

    function onSpinTap() {
      trackEvent("MINIAPP_ROULETTE_SPIN1");
      _tryUnlockEntranceAudio(); // clique real e direto — necessário pro destravamento funcionar de fato
      spinBtn.disabled = true;
      spinBtn.classList.add("rwSpinBtn-disabled");
      runSpin(RW_LOSE_INDEX, onFirstSpinDone);
    }
    spinBtn.addEventListener("click", onSpinTap, { once: true });

    // tremor curto na roleta — vende o "quase" sem tocar na física do giro.
    function triggerNearMissShake() {
      const wrap = screen.querySelector(".rwWheelWrap");
      if (!wrap) return;
      wrap.classList.add("rwWheelWrap-shake");
      setTimeout(() => wrap.classList.remove("rwWheelWrap-shake"), 420);
    }

    // flash vermelho breve — mesma técnica do flash dourado da vitória,
    // recolorido, um elemento descartável que se auto-remove.
    function triggerNearMissFlash() {
      const flash = document.createElement("div");
      flash.className = "rwLossFlash";
      screen.appendChild(flash);
      setTimeout(() => flash.remove(), 600);
    }

    // 1ª tentativa — sempre cai em ❌ TENTE DE NOVO. Sem confete, feedback
    // mais contido (vibração de erro, thud curto, tremor+flash vermelho).
    function onFirstSpinDone() {
      hapticNotify("error");
      rwPlayLossThud();
      triggerNearMissShake();
      triggerNearMissFlash();

      spinBtn.classList.add("rwSpinBtn-hidden");
      setTimeout(() => spinBtn.remove(), 450);

      actionArea.insertAdjacentHTML("beforeend", `
        <div class="rwResult">
          <div class="rwResultTitle">❌ QUASE...</div>
          <div class="rwResultSub">Você passou muito perto do prêmio máximo.<br>Mas você ainda possui <strong>UMA</strong> última tentativa exclusiva.</div>
        </div>
      `);
      requestAnimationFrame(() => actionArea.querySelector(".rwResult")?.classList.add("rwResult-visible"));

      // sem botão de fechar — só o próprio CTA avança o fluxo.
      setTimeout(() => {
        actionArea.insertAdjacentHTML("beforeend", `<button type="button" class="rwEnterBtn">🔄 TENTAR NOVAMENTE</button>`);
        const retryBtn = actionArea.querySelector(".rwEnterBtn");
        requestAnimationFrame(() => retryBtn.classList.add("rwEnterBtn-visible"));
        retryBtn.addEventListener("click", onRetryTap, { once: true });
      }, 400);
    }

    function onRetryTap() {
      trackEvent("MINIAPP_ROULETTE_SPIN2");
      hapticImpact("medium");

      // some com o resultado da 1ª tentativa antes de girar de novo.
      const prevResult = actionArea.querySelector(".rwResult");
      const prevBtn = actionArea.querySelector(".rwEnterBtn");
      prevResult?.classList.remove("rwResult-visible");
      prevBtn?.classList.remove("rwEnterBtn-visible");
      setTimeout(() => { prevResult?.remove(); prevBtn?.remove(); }, 350);

      runSpin(RW_WIN_INDEX, onFinalSpinDone);
    }

    // efeitos exclusivos da vitória: glow dourado intensificado + flash
    // suave + escurecimento leve do fundo, além do confete/fanfarra já
    // existentes.
    function triggerWinFlash() {
      screen.querySelector(".rwBg")?.classList.add("rwBg-dim");
      stage.querySelector(".rwGlow")?.classList.add("rwGlow-winPulse");
      const flash = document.createElement("div");
      flash.className = "rwWinFlash";
      screen.appendChild(flash);
      setTimeout(() => flash.remove(), 650);
    }

    // 2ª tentativa — sempre cai em 👑 PREMIUM.
    function onFinalSpinDone() {
      trackEvent("MINIAPP_ROULETTE_WIN");
      lsPlayWinFanfare();
      hapticNotify("success");
      confetti = mountConfettiBurst(screen);
      triggerWinFlash();

      actionArea.insertAdjacentHTML("beforeend", `
        <div class="rwResult">
          <div class="rwResultTitle">👑 ACESSO PREMIUM LIBERADO</div>
          <div class="rwResultSub">Parabéns! Seu acesso foi validado com sucesso. Todos os recursos Premium foram desbloqueados.</div>
        </div>
      `);
      requestAnimationFrame(() => actionArea.querySelector(".rwResult")?.classList.add("rwResult-visible"));

      setTimeout(() => {
        actionArea.insertAdjacentHTML("beforeend", `<button type="button" class="rwEnterBtn">✨ ENTRAR AGORA</button>`);
        const enterBtn = actionArea.querySelector(".rwEnterBtn");
        requestAnimationFrame(() => enterBtn.classList.add("rwEnterBtn-visible"));
        enterBtn.addEventListener("click", onEnterTap, { once: true });
      }, 400);

      state.flags.rouletteDone = true;
      saveState();
    }

    // Saída simples: só um fade (reaproveitando a mesma transição de opacidade
    // já usada na entrada da tela, via remoção de .lsScreen-visible) — sem
    // blackout/spinner/shockwave/iris, mas mantém o som de confirmação.
    // mountChat() já faz seu próprio fadeIn.
    function onEnterTap() {
      trackEvent("MINIAPP_ROULETTE_ENTER_TAP");
      hapticImpact("medium");
      lsPlaySuccessChime();
      particles.stop();
      wheel.destroy();
      confetti?.stop();
      screen.classList.remove("lsScreen-visible");
      screen.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 500); // rede de segurança caso transitionend não dispare
    }

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      screen.remove();
      resolve();
    }
  });
}

// ==================== ROLETA DE DESCONTO (pós "DESBLOQUEAR ACESSO") ====================
// Reaproveita o MESMO engine da roleta original — mountRouletteWheel,
// drawWheel, spinWheel, computeRouletteTarget, mountConfettiBurst,
// mountParticleSystem, sons/haptics — tudo já parametrizado por
// `segments`/índice-alvo, nenhuma linha de motor duplicada. Só os dados
// (fatias, textos) e o fluxo de alto nível mudam: aqui é uma única
// tentativa, sempre vitória, sem a etapa de "quase" da roleta original.

const DISCOUNT_WIN_INDEX = 0; // 🔥 40% OFF PREMIUM

// Ordem importa aqui: no sentido em que o giro avança, o segmento no índice
// 1 é sempre o último a passar pelo ponteiro ANTES do vencedor (índice 0)
// pousar — por isso "35% OFF" foi colocado ali (era "10% OFF"), pra bater
// com o suspense "quase caiu em 35%" (ver spinWheel/suspense).
const DISCOUNT_SEGMENTS = [
  { emoji: "🔥", label: "40% OFF\nPREMIUM", gold: true,
    stops: [[0, "#f6ddaa"], [0.55, "#d6b07a"], [1, "#a97c3a"]] },
  { emoji: "🎁", label: "35% OFF",
    stops: [[0, "#280810"], [1, "#150509"]], glow: "rgba(235,60,85,.5)" },
  { emoji: "🎁", label: "20% OFF",
    stops: [[0, "#330a17"], [1, "#1c060c"]], glow: "rgba(255,64,110,.5)" },
  { emoji: "🎁", label: "15% OFF",
    stops: [[0, "#2a0810"], [1, "#160508"]], glow: "rgba(255,45,70,.5)" },
  { emoji: "🎁", label: "30% OFF",
    stops: [[0, "#350c14"], [1, "#1a060a"]], glow: "rgba(255,90,90,.5)" },
  { emoji: "🎁", label: "5% OFF",
    stops: [[0, "#26080d"], [1, "#130407"]], glow: "rgba(214,90,90,.5)" },
  { emoji: "🎁", label: "25% OFF",
    stops: [[0, "#300a12"], [1, "#18060a"]], glow: "rgba(255,70,100,.5)" },
  { emoji: "🎁", label: "10% OFF",
    stops: [[0, "#2c0d12"], [1, "#170609"]], glow: "rgba(230,57,80,.5)" },
];

function runDiscountRouletteScreen() {
  trackEvent("MINIAPP_DISCOUNT_ROULETTE_SCREEN");
  return new Promise((resolve) => {
    const screen = document.createElement("div");
    screen.className = "lsScreen";
    // body, não #app — precisa ficar por cima do overlay do paywall
    // (z-index 9800) que ainda pode estar se fechando por baixo.
    document.body.appendChild(screen);
    screen.insertAdjacentHTML("beforeend", `<div class="rwBg rwBg-red"></div>`);

    const particles = mountParticleSystem(screen);

    screen.insertAdjacentHTML("beforeend", `
      <div class="rwStage">
        <div class="rwTitle">🔓 BENEFÍCIO PREMIUM LIBERADO</div>
        <div class="rwSubtitle">Você concluiu todas as etapas e desbloqueou uma oferta exclusiva disponível somente nesta sessão.</div>
      </div>
    `);
    const stage = screen.querySelector(".rwStage");
    const wheel = mountRouletteWheel(stage, DISCOUNT_SEGMENTS, 0.75); // ~25% menor, só o "40% OFF PREMIUM"

    stage.insertAdjacentHTML("beforeend", `
      <div class="rwActionArea rwActionArea-tall">
        <button type="button" class="rwSpinBtn">GIRAR 🎰</button>
      </div>
    `);
    const actionArea = stage.querySelector(".rwActionArea");
    const spinBtn = actionArea.querySelector(".rwSpinBtn");

    requestAnimationFrame(() => {
      screen.classList.add("lsScreen-visible");
      spinBtn.classList.add("rwSpinBtn-visible");
    });

    // Efeito sonoro de entrada — mesmo whoosh+chime usados na revelação da
    // tela de entrada, reforçando a sensação de "algo se abrindo".
    esPlayWhoosh();
    lsPlaySuccessChime();
    hapticImpact("medium");

    let confetti = null;

    function onSpinTap() {
      trackEvent("MINIAPP_DISCOUNT_ROULETTE_SPIN");
      spinBtn.disabled = true;
      spinBtn.classList.add("rwSpinBtn-disabled");
      stage.querySelector(".rwGlow")?.classList.add("rwGlow-spinning");
      hapticImpact("medium");

      const finalRotation = computeRouletteTarget(DISCOUNT_WIN_INDEX);
      let lastTickAt = 0;
      wheel.spin(finalRotation, () => {
        const t = performance.now();
        if (t - lastTickAt < 40) return;
        lastTickAt = t;
        lsPlaySpinTick();
        hapticImpact("light");
      }, true).then(onSpinDone); // true = suspense cinematográfico no trecho final (só aqui)
    }
    spinBtn.addEventListener("click", onSpinTap, { once: true });

    // Vitória — mesmos efeitos da roleta original (glow dourado, flash,
    // escurecimento do fundo, confete, fanfarra, vibração de sucesso).
    function onSpinDone() {
      lsPlayWinFanfare();
      hapticNotify("success");
      confetti = mountConfettiBurst(screen);

      screen.querySelector(".rwBg")?.classList.add("rwBg-dim");
      stage.querySelector(".rwGlow")?.classList.add("rwGlow-winPulse");
      const flash = document.createElement("div");
      flash.className = "rwWinFlash";
      screen.appendChild(flash);
      setTimeout(() => flash.remove(), 650);

      spinBtn.classList.add("rwSpinBtn-hidden");
      setTimeout(() => spinBtn.remove(), 450);

      actionArea.insertAdjacentHTML("beforeend", `
        <div class="rwResult">
          <div class="rwResultTitle">🎉 PARABÉNS!</div>
          <div class="rwResultSub">Você desbloqueou seu desconto exclusivo. A oferta já está ativa para você.</div>
        </div>
      `);
      requestAnimationFrame(() => actionArea.querySelector(".rwResult")?.classList.add("rwResult-visible"));

      setTimeout(() => {
        actionArea.insertAdjacentHTML("beforeend", `
          <div class="rwPrizeCard">
            <div class="rwPrizeCardTitle">🔥 DESCONTO LIBERADO</div>
            <div class="rwPrizeCardValue">40% OFF PREMIUM</div>
            <div class="rwPrizeCardNote">Oferta exclusiva desta sessão.</div>
          </div>
        `);
        requestAnimationFrame(() => actionArea.querySelector(".rwPrizeCard")?.classList.add("rwPrizeCard-visible"));
      }, 350);

      setTimeout(() => {
        actionArea.insertAdjacentHTML("beforeend", `<button type="button" class="rwEnterBtn">🔥 GARANTIR 40% DE DESCONTO</button>`);
        const claimBtn = actionArea.querySelector(".rwEnterBtn");
        requestAnimationFrame(() => claimBtn.classList.add("rwEnterBtn-visible"));
        claimBtn.addEventListener("click", onClaimTap, { once: true });
      }, 750);
    }

    // Saída: mesmo fade simples do resto do app, seguido do redirecionamento
    // real pro checkout/Telegram (é aqui, e só aqui, que openCheckout roda —
    // nunca mais direto no clique de "DESBLOQUEAR ACESSO" do paywall).
    function onClaimTap() {
      trackEvent("MINIAPP_DISCOUNT_ROULETTE_CLAIM");
      hapticImpact("medium");
      lsPlaySuccessChime();
      particles.stop();
      wheel.destroy();
      confetti?.stop();
      screen.classList.remove("lsScreen-visible");
      screen.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 500); // rede de segurança caso transitionend não dispare
    }

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      screen.remove();
      resolve();
      openCheckout();
    }
  });
}

// ==================== ENTRADA CINEMATOGRÁFICA (pós-roleta) ====================
// Tela "dark luxury" entre a vitória da roleta e o chat: cortinas de veludo
// abrem, silhueta com rim-light vermelho revela, selo com glitch, headline,
// subtítulo e CTA — timeline fixa e coreografada (setTimeout em cadeia,
// mesmo estilo já usado nas sequências de saída deste arquivo), sem rAF
// próprio (não há nada contínuo pra animar quadro a quadro aqui, ao
// contrário da roleta). Parallax de mouse foi propositalmente omitido nessa
// versão mobile-first (Telegram Mini App é touch, não teria efeito real).
//
// Timeline (ms desde o mount) — comprimida por ES_REDUCED_MOTION_SCALE
// quando prefers-reduced-motion está ativo:
const ES_PHASE_MS = { curtains: 800, silhouette: 1800, badge: 2500, headline: 3300, subtitle: 4200, cta: 5000 };
const ES_REDUCED_MOTION_SCALE = 0.3;

const ES_EMBER_COLORS = [[255, 45, 70], [214, 176, 122]]; // vermelho / dourado

function esPrefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

function runEntranceScreen() {
  trackEvent("MINIAPP_ENTRANCE_SCREEN");
  return new Promise((resolve) => {
    const reduced = esPrefersReducedMotion();
    const scale = reduced ? ES_REDUCED_MOTION_SCALE : 1;

    const screen = document.createElement("div");
    screen.className = reduced ? "lsScreen es-reduced" : "lsScreen";
    app.appendChild(screen);

    screen.insertAdjacentHTML("beforeend", `
      <div class="esBg"></div>
      <div class="esCurtainL"></div>
      <div class="esCurtainR"></div>

      <div class="esSilhouetteWrap">
        <div class="esGlow"></div>
        <video class="esSilhouette" src="${ASSETS.entranceTeaser}" autoplay loop muted playsinline
          webkit-playsinline aria-hidden="true"></video>
        <div class="esVignette"></div>
      </div>

      <button type="button" class="esSoundToggle" aria-pressed="true" aria-label="Desativar som">${esSoundIcon(true)}</button>

      <div class="esStage">
        <div class="esBadge">
          <span class="esGlitchBase">ACESSO LIBERADO</span>
          <span class="esGlitchR" aria-hidden="true">ACESSO LIBERADO</span>
          <span class="esGlitchC" aria-hidden="true">ACESSO LIBERADO</span>
        </div>
        <h1 class="esHeadline">VOCÊ ESTÁ DENTRO</h1>
        <p class="esSubtitle">Chat Exclusivo • ${escapeHtml(CONTACT.name)}</p>
        <button type="button" class="esCta">
          <span class="esCtaRing" aria-hidden="true"></span>
          <span class="esCtaLabel">CLIQUE E ENTRE AO VIVO COMIGO AGORA 🔥</span>
        </button>
      </div>
    `);

    const particles = mountParticleSystem(screen, ES_EMBER_COLORS);
    const soundBtn = screen.querySelector(".esSoundToggle");
    const ctaBtn = screen.querySelector(".esCta");

    // autoplay+muted+playsinline no HTML já cobre a maioria dos casos, mas
    // alguns WebViews mobile só engatam de verdade com um .play() explícito
    // (mesmo padrão já usado em mountBackgroundVideo). loop nativo cuida do
    // resto — roda infinito até a tela ser removida no onEnterTap.
    screen.querySelector(".esSilhouette")?.play().catch(() => {});

    // Som começa LIGADO por padrão (diferente do resto do app onde já vinha
    // ligado desde o início) — a essa altura o usuário já tocou em GIRAR/
    // TENTAR NOVAMENTE/ENTRAR AGORA na roleta, então o AudioContext
    // compartilhado já está desbloqueado; não faz sentido pedir mais um
    // toque só pra ouvir o áudio dessa seção. O botão continua ali pra quem
    // preferir silenciar.
    let soundOn = true;
    let stopDrone = esStartAmbientDrone();

    // Música real (não sintetizada) que entra junto com a abertura da
    // cortina — começa direto do segundo 46, que é onde o trecho pedido
    // começa. entranceMusicStarted evita re-buscar/re-setar currentTime
    // toda vez que o usuário alterna o botão de som.
    let entranceMusicStarted = false;
    const entranceAudio = getEntranceAudio();
    function startEntranceMusic() {
      entranceMusicStarted = true;
      // Corta de vez as tentativas de destravar aqui, independente de ter
      // conseguido ou não — depois da cortina não há mais benefício em
      // insistir, só o risco de ficar chamando play() (mesmo mudo) em todo
      // toque durante o chat/chamada mais tarde.
      _stopTryingToUnlockEntranceAudio();
      const seek = () => {
        try { entranceAudio.currentTime = 56.63; } catch {}
        entranceAudio.play().then(() => {
          entranceAudio.muted = false; // só aqui, no início real, sai do mudo permanente
          esFadeInAudio(entranceAudio, ENTRANCE_MUSIC_VOLUME, 1500);
        }).catch(() => {});
      };
      if (entranceAudio.readyState >= 1) seek();
      else entranceAudio.addEventListener("loadedmetadata", seek, { once: true });
    }

    function playIfSound(fn) { if (soundOn) fn(); }

    soundBtn.addEventListener("click", () => {
      soundOn = !soundOn;
      soundBtn.setAttribute("aria-pressed", String(soundOn));
      soundBtn.setAttribute("aria-label", soundOn ? "Desativar som" : "Ativar som");
      soundBtn.innerHTML = esSoundIcon(soundOn);
      if (soundOn) {
        stopDrone = esStartAmbientDrone();
        if (entranceMusicStarted) {
          entranceAudio.volume = ENTRANCE_MUSIC_VOLUME;
          entranceAudio.play().catch(() => {});
        }
      } else {
        if (stopDrone) { stopDrone(); stopDrone = null; }
        entranceAudio.pause();
      }
    });

    requestAnimationFrame(() => screen.classList.add("lsScreen-visible"));

    const timers = [
      setTimeout(() => {
        screen.classList.add("es-curtains-open");
        playIfSound(esPlayWhoosh);
        playIfSound(startEntranceMusic);
      }, ES_PHASE_MS.curtains * scale),

      setTimeout(() => {
        screen.querySelector(".esSilhouetteWrap")?.classList.add("es-visible");
        playIfSound(esPlayRevealShimmer);
      }, ES_PHASE_MS.silhouette * scale),

      setTimeout(() => {
        screen.querySelector(".esBadge")?.classList.add("es-visible");
        playIfSound(lsPlaySpinTick);
      }, ES_PHASE_MS.badge * scale),

      setTimeout(() => screen.querySelector(".esHeadline")?.classList.add("es-visible"), ES_PHASE_MS.headline * scale),

      setTimeout(() => screen.querySelector(".esSubtitle")?.classList.add("es-visible"), ES_PHASE_MS.subtitle * scale),

      setTimeout(() => {
        ctaBtn.classList.add("es-visible");
        playIfSound(lsPlaySuccessChime);
      }, ES_PHASE_MS.cta * scale),
    ];

    ctaBtn.addEventListener("click", onEnterTap, { once: true });

    // Saída rápida (crossfade ~180-280ms) — diferente do fade simples ~420ms
    // usado no resto do app: aqui a tela atual e o chat aparecem juntos,
    // sobrepostos, em vez de um terminar antes do outro começar.
    //
    // mountChat() faz `app.innerHTML = ...` — se `screen` continuasse
    // dentro de #app ela seria destruída instantaneamente nesse replace,
    // sem chance de fazer o próprio fade de saída. Por isso reparentamos
    // pro <body> antes: .lsScreen já é position:fixed;inset:0, e como essa
    // tela não tem nenhum campo de texto (o teclado nunca abre aqui), mover
    // pro body não muda nada visualmente — só deixa ela livre pra continuar
    // visível por cima do chat recém-montado enquanto os dois se cruzam.
    async function onEnterTap() {
      trackEvent("MINIAPP_ENTRANCE_CTA_TAP");
      ctaBtn.disabled = true;
      ctaBtn.classList.add("esCta-shine");
      hapticImpact("light");

      // Esconde a tela de entrada (silhueta) ANTES da tela de carregamento
      // cobrir tudo — sem isso, ao sumir o carregamento, a silhueta
      // reaparecia por um instante antes do crossfade pro chat começar.
      screen.classList.remove("lsScreen-visible");
      screen.querySelector(".esSilhouette")?.pause();

      // Mesma tela de carregamento de 2s do início do app (com o mesmo
      // som) antes do efeito que revela o chat.
      await runInitialLoadingScreen();

      // whoosh (mesmo som das cortinas — reforça o tema) + chime junto,
      // uma confirmação mais "cheia" pro momento de sair da tela.
      playIfSound(esPlayWhoosh);
      playIfSound(lsPlaySuccessChime);
      particles.stop();
      if (stopDrone) stopDrone();
      entranceAudio.pause();

      document.body.appendChild(screen);
      requestAnimationFrame(() => screen.classList.add("esCtaExit"));

      mountChat(); // chat já começa a aparecer por baixo, ao mesmo tempo
      const chatFull = app.querySelector(".full");
      if (chatFull) {
        // .fadeIn é a entrada padrão do mountChat() (usada em todos os
        // outros lugares que chamam essa função) — trocada só aqui, nesse
        // ponto de entrada específico, pela animação premium pedida.
        chatFull.classList.remove("fadeIn");
        chatFull.classList.add("chatEnterPremium");

        const shine = document.createElement("div");
        shine.className = "chatTopShine";
        chatFull.appendChild(shine);
        setTimeout(() => shine.remove(), 500);
      }

      screen.addEventListener("transitionend", cleanup, { once: true });
      setTimeout(cleanup, 260); // rede de segurança caso transitionend não dispare
    }

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      timers.forEach(clearTimeout);
      screen.remove();
      resolve();
    }
  });
}

function esSoundIcon(on) {
  return on
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke-linecap="round"/></svg>`;
}

// ==================== MOUNT CHAT ====================
function mountChat() {
  const _ls = new Date(Date.now() - 10 * 60 * 1000);
  const _lsStr = state.flags.botOnline
    ? "online"
    : `visto por último às ${String(_ls.getHours()).padStart(2,"0")}:${String(_ls.getMinutes()).padStart(2,"0")}`;
  app.innerHTML = `
    <div class="full fadeIn">

      <div class="topbar">
        <button class="navBtn" onclick="return false;"><span class="navChevron"></span></button>

        <div data-story-avatar id="topbarAvatar" style="width:42px;height:42px;border-radius:50%;border:2px solid ${window.storyViewed ? "rgba(255,255,255,.2)" : "#25D366"};padding:2px;flex-shrink:0;box-sizing:border-box;">
          <img src="${ASSETS.avatar}?v=1" style="width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:top;display:block;" />
        </div>

        <div onclick="openProfile()" style="flex:1;min-width:0;cursor:pointer;">
          <div style="font-size:15px;font-weight:600;color:#e9edef;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${CONTACT.title}</div>
          <div id="status" style="font-size:12.5px;color:#8696a0;margin-top:1px;">${_lsStr}</div>
        </div>

        <div style="display:flex;align-items:center;gap:20px;padding-right:6px;">
          <button onclick="startVideoCall()" style="background:none;border:none;padding:0;display:flex;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="7" width="13" height="10" rx="2.5"></rect><path d="M15 9.5l5.5-3v11l-5.5-3z"></path>
            </svg>
          </button>
          <button onclick="startCall()" style="background:none;border:none;padding:0;display:flex;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v2.5a1.8 1.8 0 0 1-2 1.8 19 19 0 0 1-8.2-2.9 18.7 18.7 0 0 1-5.8-5.8 19 19 0 0 1-2.62-8.52 1.8 1.8 0 0 1 1.8-1.8h2.5a1.8 1.8 0 0 1 1.7 1.5c.12.8.3 1.6.55 2.3a1.8 1.8 0 0 1-.4 1.8L7.9 9.5a15 15 0 0 0 6.6 6.6l1.9-1.4a1.8 1.8 0 0 1 1.8-.4c.7.25 1.5.43 2.3.55A1.8 1.8 0 0 1 22 16.92z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="chatShell">
        <div class="chat" id="chat"></div>
      </div>

      <div id="replyPreviewBar" class="replyPreviewBar is-hidden"></div>
      <div class="composer" id="composer">
        <button class="composerAttach" type="button" onclick="return false;">+</button>
        <div class="composerField">
          <textarea id="input" rows="1" placeholder="Mensagem" autocomplete="off" autocorrect="off"></textarea>
          <button class="composerCamera" type="button" onclick="return false;">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5a2 2 0 0 1 2-2h1.2l1-1.6h7.6l1 1.6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z"/><circle cx="12" cy="13" r="3.4"/></svg>
          </button>
        </div>
        <button class="composerMic" id="composerMic" type="button" onclick="return false;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21.5"/></svg>
        </button>
        <button class="send is-hidden" id="send" type="button" onclick="onSend()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="13 5 20 12 13 19"/></svg>
        </button>
      </div>

    </div>
  `;

  state.chatEl = document.getElementById("chat");
  // Abre foto em tela cheia ao tocar — delegado no container (os itens são
  // re-renderizados), não interfere no swipe-pra-responder (esse é só um
  // "click" normal, que não dispara depois de um gesto de arrastar).
  state.chatEl.addEventListener("click", (e) => {
    const thumb = e.target.closest("[data-photo-src]");
    if (thumb) openPhotoViewer(thumb.getAttribute("data-photo-src"));
  });
  // reaplica o último status conhecido (digitando/gravando áudio/enviando
  // vídeo/online) — sem isso, remontar o chat sempre resetava pro texto
  // padrão calculado acima, mesmo com algo em andamento de verdade.
  if (_lastStatusText) {
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = _lastStatusText;
  }
  restoreHistory();
  // se um gisaSay() estava no meio da fase "digitando" quando o chat foi
  // remontado (ex.: pessoa foi no perfil/stories e voltou), reconstrói o
  // indicador aqui — sem isso ele ficava preso no #chat antigo, invisível.
  if (_typingActive) addTyping();
  renderReplyPreviewBar(); // restaura o preview de resposta se sobreviveu a um remount
  bindComposer();
  FocusGateway.attach(document.getElementById("input"), document.getElementById("chat"));
  attachProfilePhotoPreview(document.getElementById("topbarAvatar"), { onTap: showStories });

  // Force GPU compositor layer to activate before first touch
  requestAnimationFrame(() => {
    const chat = document.getElementById("chat");
    if (!chat) return;
    const s = chat.scrollTop;
    chat.scrollTop = s + 1;
    chat.scrollTop = s;
  });
}

const COMPOSER_MAX_HEIGHT = 120; // ~6 linhas — mesmo teto visual do WhatsApp antes de rolar internamente

// fallback JS pro auto-grow, só ativo quando o engine NÃO suporta CSS
// field-sizing:content. Escrever uma altura inline sempre, mesmo com
// suporte nativo, sobrescreveria o comportamento do CSS incondicionalmente
// (inline sempre vence) — o feature-detect é o que garante que isto seja
// progressive enhancement de verdade, não um JS que sempre vence o CSS.
const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function autoGrowComposer(el) {
  if (SUPPORTS_FIELD_SIZING) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT) + "px";
}

function bindComposer() {
  const input   = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const micBtn  = document.getElementById("composerMic");
  if (!input || !sendBtn || !micBtn) return;

  input.addEventListener("input", () => {
    const hasText = input.value.trim().length > 0;
    sendBtn.classList.toggle("is-hidden", !hasText);
    micBtn.classList.toggle("is-hidden", hasText);
    autoGrowComposer(input);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onSend(); }
  });
}

// ==================== FIX #2+3: SVG ICONS GLOBAIS (usados por startCall) ====================
const speakerIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 10h3l4-3v10l-4-3H5z"/>
    <path d="M15 9c1.2 1.2 1.2 4.8 0 6"/>
  </svg>`;

const videoIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="6.5" width="13" height="11" rx="3"/>
    <path d="M16 10l4-2v8l-4-2z"/>
  </svg>`;

const muteIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 10h3l4-3v10l-4-3H5z"/>
    <line x1="17" y1="9" x2="21" y2="15"/>
    <line x1="21" y1="9" x2="17" y2="15"/>
  </svg>`;

const moreIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff">
    <circle cx="6" cy="12" r="1.6"/>
    <circle cx="12" cy="12" r="1.6"/>
    <circle cx="18" cy="12" r="1.6"/>
  </svg>`;

const shareIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="7" width="12" height="10" rx="2.5"/>
    <path d="M15 10l5-3v10l-5-3z"/>
  </svg>`;

const endIcon = () => `
  <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff">
    <path d="M6 10.5c4-3 8-3 12 0l-1.8 2c-2.8-2-5.6-2-8.4 0l-1.8-2z"/>
  </svg>`;

// ── callBtn helper (usado por startCall) ─────────────────────────────────────
function callBtn(icon, label, action = "", disabled = false) {
  return `
    <div class="call-btn" data-action="${action}" style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:transparent;border:none;outline:none;
      ${disabled ? "pointer-events:none;" : "cursor:pointer;"}
    ">
      <div class="call-btn-circle" style="
        width:58px;height:58px;
        background:${disabled ? "#3a3a3c" : "#2c2c2e"};
        border-radius:50%;display:flex;align-items:center;justify-content:center;
      ">
        <div style="display:flex;align-items:center;justify-content:center;${disabled ? "opacity:0.35;" : ""}">
          ${icon}
        </div>
      </div>
      ${label ? `<span style="margin-top:6px;font-size:13px;color:${disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.85)"};">${label}</span>` : ""}
    </div>
  `;
}

function endCallBtn() {
  return `
    <div class="call-btn" data-action="end" style="display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:transparent;">
      <div class="call-btn-circle" style="width:58px;height:58px;background:#ff3b30;border-radius:50%;display:flex;align-items:center;justify-content:center;">
        ${endIcon()}
      </div>
    </div>
  `;
}

// =============================================================================
// SUBSTITUA window.startVideoCall NO SEU app.js POR ESTA FUNÇÃO INTEIRA
// =============================================================================

window.startVideoCall = async function () {

  let stream;
  let currentFacing = "user";
  let isSwitching   = false;
  let isMutedVC     = false;  // mic começa NORMAL
  let isSpeakerVC   = true;   // speaker ATIVO por padrão

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacing },
      audio: false,
    });
  } catch {
    console.warn("Permissão de câmera negada");
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // SVG ICONS — pixel a pixel iguais às fotos
  // ═══════════════════════════════════════════════════════════════

  const ICO_MORE = `
    <svg width="20" height="6" viewBox="0 0 20 6" fill="rgba(255,255,255,0.88)">
      <circle cx="2"  cy="3" r="2.1"/>
      <circle cx="10" cy="3" r="2.1"/>
      <circle cx="18" cy="3" r="2.1"/>
    </svg>`;

  const ICO_SPEAKER_ON = `
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <path d="M5 11H9L15 6.5V23.5L9 19H5V11Z" fill="#111"/>
      <path d="M18.5 11.5C19.6 12.6 19.6 17.4 18.5 18.5"
            stroke="#111" stroke-width="2.1" stroke-linecap="round" fill="none"/>
      <path d="M21.5 9C23.8 11.3 23.8 18.7 21.5 21"
            stroke="#111" stroke-width="2.1" stroke-linecap="round" fill="none"/>
      <path d="M24.5 6.5C28 10 28 20 24.5 23.5"
            stroke="#111" stroke-width="2.1" stroke-linecap="round" fill="none"/>
    </svg>`;

  const ICO_SPEAKER_OFF = `
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <path d="M5 11H9L15 6.5V23.5L9 19H5V11Z" fill="rgba(255,255,255,0.88)"/>
      <line x1="19" y1="10" x2="26" y2="20" stroke="rgba(255,255,255,0.88)" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="26" y1="10" x2="19" y2="20" stroke="rgba(255,255,255,0.88)" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;

  // câmera — cinza sobre cinza, não clicável
  const ICO_CAM = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="2" y="9" width="20" height="14" rx="3.5" fill="rgba(205,198,198,0.78)"/>
      <path d="M22 13.5L29.5 10V22L22 18.5V13.5Z" fill="rgba(205,198,198,0.78)"/>
    </svg>`;

  // mic normal — branco, fundo escuro
  const ICO_MIC_ON = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="rgba(255,255,255,0.88)"/>
      <path d="M5 11a7 7 0 0 0 14 0"
            stroke="rgba(255,255,255,0.88)" stroke-width="2"
            stroke-linecap="round" fill="none"/>
      <line x1="12" y1="18" x2="12" y2="22"
            stroke="rgba(255,255,255,0.88)" stroke-width="2" stroke-linecap="round"/>
      <line x1="9"  y1="22" x2="15" y2="22"
            stroke="rgba(255,255,255,0.88)" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

  // mic mutado — vermelho + riscado, fundo branco
  const ICO_MIC_MUTED = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="#c62828"/>
      <path d="M5 11a7 7 0 0 0 14 0"
            stroke="#c62828" stroke-width="2"
            stroke-linecap="round" fill="none"/>
      <line x1="12" y1="18" x2="12" y2="22"
            stroke="#c62828" stroke-width="2" stroke-linecap="round"/>
      <line x1="9"  y1="22" x2="15" y2="22"
            stroke="#c62828" stroke-width="2" stroke-linecap="round"/>
      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5"
            stroke="#c62828" stroke-width="2.3" stroke-linecap="round"/>
    </svg>`;

  // desligar — receiver clássico branco
  const ICO_END = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2
               c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57
               .55 0 1 .45 1 1V20c0 .55-.45 1-1 1
               C10.29 21 3 13.71 3 4.99 3 4.44 3.45 4 4 4h3.5
               c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57
               .11.35.03.74-.25 1.02l-2.2 2.2z"/>
    </svg>`;

  // ═══════════════════════════════════════════════════════════════
  // HELPER — botão circular
  // ═══════════════════════════════════════════════════════════════
  const mkBtn = (id, bg, icon, clickable = true, size = "66px") => `
    <div id="${id}" style="
      display:flex;align-items:center;justify-content:center;
      flex-direction:column;gap:6px;flex-shrink:0;
      ${clickable ? "cursor:pointer;" : "pointer-events:none;"}
      user-select:none;-webkit-tap-highlight-color:transparent;
    ">
      <div id="${id}-bg" style="
        width:${size};height:${size};border-radius:50%;
        background:${bg};
        display:flex;align-items:center;justify-content:center;
        transition:background .18s ease, transform .12s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 4px 18px rgba(0,0,0,0.28);
      ">
        <div id="${id}-icon" style="
          display:flex;align-items:center;justify-content:center;line-height:0;
        ">${icon}</div>
      </div>
    </div>`;

  // ═══════════════════════════════════════════════════════════════
  // HTML
  // ═══════════════════════════════════════════════════════════════
  app.innerHTML = `
    <div id="vcScreen" style="
      position:relative;height:100dvh;
      background:#3a2020;overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      opacity:0;transform:scale(1.03);
      transition:opacity .22s ease,transform .22s ease;
    ">

      <!-- vídeo sempre ativo -->
      <video id="vcVideo" autoplay playsinline muted style="
        position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
      "></video>

      <!-- gradiente topo -->
      <div style="
        position:absolute;top:0;left:0;right:0;height:220px;
        background:linear-gradient(to bottom,rgba(0,0,0,.65),transparent);
        pointer-events:none;z-index:2;
      "></div>

      <!-- nome + status -->
      <div id="vcTopBar" style="position:absolute;top:52px;width:100%;text-align:center;z-index:3;transition:opacity .25s ease;">
        <div style="font-size:23px;font-weight:700;color:#fff;letter-spacing:-.4px;
                    text-shadow:0 1px 8px rgba(0,0,0,0.4);">
          ${CONTACT.title}
        </div>
        <div style="margin-top:6px;font-size:14px;color:rgba(255,255,255,.65);
                    letter-spacing:.2px;">
          Chamando...
        </div>
      </div>

      <!-- botão girar câmera -->
      <div id="vcFlip" style="
        position:absolute;right:20px;top:128px;transition:opacity .25s ease;
        width:46px;height:46px;border-radius:50%;
        background:rgba(0,0,0,0.35);
        backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        display:flex;align-items:center;justify-content:center;
        z-index:10;cursor:pointer;
        box-shadow:0 2px 12px rgba(0,0,0,0.3);
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,.9)" stroke-width="2.1"
            stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"/>
          <path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
        </svg>
      </div>

      <!-- gradiente baixo -->
      <div style="
        position:absolute;bottom:0;left:0;right:0;height:260px;
        background:linear-gradient(to top,rgba(0,0,0,.78),transparent);
        pointer-events:none;z-index:2;
      "></div>

      <!-- ═══ BARRA DE CONTROLES ═══ -->
      <div id="vcControlsBar" style="
        position:absolute;bottom:48px;left:0;right:0;
        display:flex;justify-content:center;z-index:10;
        transition:opacity .25s ease;
      ">
        <div style="
          background:rgba(50,32,32,0.50);
          backdrop-filter:blur(28px);
          -webkit-backdrop-filter:blur(28px);
          border-radius:56px;
          padding:14px 20px;
          display:flex;gap:14px;align-items:center;
          border:0.5px solid rgba(255,255,255,0.08);
        ">
          ${mkBtn("vcMore",    "rgba(100,78,78,0.82)", ICO_MORE,       true)}
          ${mkBtn("vcSpeaker", "#ffffff",               ICO_SPEAKER_ON, true)}
          ${mkBtn("vcCam",     "rgba(108,96,96,0.78)", ICO_CAM,        false)}
          ${mkBtn("vcMic",     "rgba(100,78,78,0.82)", ICO_MIC_ON,     true)}
          ${mkBtn("vcEnd",     "#e8242a",               ICO_END,        true)}
        </div>
      </div>

      <!-- ═══ MORE SHEET — idêntico à foto ═══ -->
      <div id="vcMoreSheet" style="
        position:fixed;inset:0;z-index:200;
        display:none;align-items:flex-end;justify-content:center;
        background:rgba(0,0,0,0.45);
        backdrop-filter:blur(4px);
        -webkit-backdrop-filter:blur(4px);
      ">
        <div style="
          width:100%;max-width:480px;
          background:#1c1c1e;
          border-top-left-radius:20px;
          border-top-right-radius:20px;
          padding:20px 20px 44px;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif;
          animation: slideUp .28s cubic-bezier(.32,.72,0,1);
        ">

          <!-- cabeçalho: cadeado + texto + X -->
          <div style="
            display:flex;align-items:flex-start;
            justify-content:space-between;
            margin-bottom:24px;
            gap:12px;
          ">
            <div style="flex:1;"></div>

            <div style="
              flex:4;
              display:flex;flex-direction:column;align-items:center;
              gap:4px;
            ">
              <div style="display:flex;align-items:center;gap:8px;">
                <!-- cadeado -->
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="rgba(255,255,255,0.85)" stroke-width="2.2"
                    stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span style="
                  color:#fff;font-size:15px;font-weight:600;
                  text-align:center;line-height:1.3;
                ">
                  Protegida com a criptografia<br>de ponta a ponta
                </span>
              </div>
            </div>

            <!-- botão X -->
            <div id="vcMoreClose" style="
              flex:1;display:flex;justify-content:flex-end;
              cursor:pointer;
            ">
              <div style="
                width:34px;height:34px;border-radius:50%;
                background:rgba(255,255,255,0.14);
                display:flex;align-items:center;justify-content:center;
              ">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
                    stroke="rgba(255,255,255,0.75)" stroke-width="2.2"
                    stroke-linecap="round">
                  <line x1="1" y1="1" x2="13" y2="13"/>
                  <line x1="13" y1="1" x2="1" y2="13"/>
                </svg>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- overlay encerrado -->
      <div id="vcEndOverlay" style="
        position:fixed;inset:0;background:#000;color:#fff;
        display:flex;flex-direction:column;align-items:center;
        justify-content:center;gap:8px;
        opacity:0;pointer-events:none;
        transition:opacity .35s ease;z-index:999;
      ">
        <div style="font-size:22px;font-weight:600;">${CONTACT.title}</div>
        <div style="font-size:15px;opacity:.6;">Chamada encerrada</div>
      </div>

    </div>

    <style>
      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to   { transform: translateY(0);   opacity: 1; }
      }
    </style>
  `;

  // ── conecta vídeo ──────────────────────────────────────────────
  const vcVideo  = document.getElementById("vcVideo");
  const vcScreen = document.getElementById("vcScreen");

  // ── tap para esconder/mostrar controles (estilo WhatsApp) ──────
  let _vcControlsVisible = true;
  let _vcHideTimer = null;
  function _vcHideControls() {
    [document.getElementById("vcTopBar"),
     document.getElementById("vcFlip"),
     document.getElementById("vcControlsBar")]
      .forEach(el => { if (el) { el.style.opacity = "0"; el.style.pointerEvents = "none"; } });
    _vcControlsVisible = false;
  }
  function _vcShowControls() {
    [document.getElementById("vcTopBar"),
     document.getElementById("vcFlip"),
     document.getElementById("vcControlsBar")]
      .forEach(el => { if (el) { el.style.opacity = "1"; el.style.pointerEvents = ""; } });
    _vcControlsVisible = true;
    clearTimeout(_vcHideTimer);
    _vcHideTimer = setTimeout(_vcHideControls, 4000);
  }
  vcScreen.addEventListener("touchend", (e) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    const bar   = document.getElementById("vcControlsBar");
    const flip  = document.getElementById("vcFlip");
    const sheet = document.getElementById("vcMoreSheet");
    if ((bar   && bar.contains(hit))   ||
        (flip  && flip.contains(hit))  ||
        (sheet && sheet.contains(hit))) return;
    if (_vcControlsVisible) _vcHideControls();
    else _vcShowControls();
  }, { passive: true });

  vcVideo.srcObject = stream;
  vcVideo.onloadedmetadata = () => {
    vcVideo.play();
    requestAnimationFrame(() => {
      vcScreen.style.opacity   = "1";
      vcScreen.style.transform = "scale(1)";
      clearTimeout(_vcHideTimer);
      _vcHideTimer = setTimeout(_vcHideControls, 4000);
    });
  };
  // fallback: se onloadedmetadata não disparar, esconde após 5s
  setTimeout(() => {
    if (!_vcHideTimer) _vcHideTimer = setTimeout(_vcHideControls, 4000);
  }, 1000);

  // ── helpers ────────────────────────────────────────────────────
  function setBg(id, color) {
    const el = document.getElementById(id + "-bg");
    if (el) el.style.background = color;
  }
  function setIcon(id, html) {
    const el = document.getElementById(id + "-icon");
    if (el) el.innerHTML = html;
  }
  function pulse(id) {
    const el = document.getElementById(id + "-bg");
    if (!el) return;
    el.style.transform = "scale(0.86)";
    setTimeout(() => { el.style.transform = "scale(1)"; }, 140);
  }

  // ── MORE SHEET ─────────────────────────────────────────────────
  const sheet = document.getElementById("vcMoreSheet");

  function openSheet() {
    sheet.style.display = "flex";
    requestAnimationFrame(() => { sheet.style.opacity = "1"; });
  }
  function closeSheet() {
    sheet.style.display = "none";
  }

  document.getElementById("vcMore").onclick = () => {
    pulse("vcMore");
    setTimeout(openSheet, 80);
  };

  document.getElementById("vcMoreClose").onclick = closeSheet;

  // fechar clicando no fundo
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) closeSheet();
  });

  // ── SPEAKER ────────────────────────────────────────────────────
  document.getElementById("vcSpeaker").onclick = () => {
    pulse("vcSpeaker");
    isSpeakerVC = !isSpeakerVC;
    if (isSpeakerVC) {
      setBg("vcSpeaker", "#ffffff");
      setIcon("vcSpeaker", ICO_SPEAKER_ON);
    } else {
      setBg("vcSpeaker", "rgba(100,78,78,0.82)");
      setIcon("vcSpeaker", ICO_SPEAKER_OFF);
    }
  };

  // ── MIC ────────────────────────────────────────────────────────
  document.getElementById("vcMic").onclick = () => {
    pulse("vcMic");
    isMutedVC = !isMutedVC;
    if (isMutedVC) {
      setBg("vcMic", "#ffffff");
      setIcon("vcMic", ICO_MIC_MUTED);
    } else {
      setBg("vcMic", "rgba(100,78,78,0.82)");
      setIcon("vcMic", ICO_MIC_ON);
    }
  };

  // ── GIRAR CÂMERA ───────────────────────────────────────────────
  document.getElementById("vcFlip").onclick = async () => {
    if (isSwitching) return;
    isSwitching = true;
    currentFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing }, audio: false,
      });
      const old = stream;
      vcVideo.srcObject = newStream;
      stream = newStream;
      setTimeout(() => old.getTracks().forEach(t => t.stop()), 120);
    } catch {}
    isSwitching = false;
  };

  // ── ENCERRAR ───────────────────────────────────────────────────
  document.getElementById("vcEnd").onclick = () => {
    clearTimeout(_vcHideTimer);
    const ol = document.getElementById("vcEndOverlay");
    if (ol) ol.style.opacity = "1";
    vcScreen.style.opacity   = "0";
    vcScreen.style.transform = "scale(.96)";
    setTimeout(() => {
      try { stream.getTracks().forEach(t => t.stop()); } catch {}
      openProfile();
    }, 380);
  };

  // encerra automaticamente após 40s
  setTimeout(() => {
    try { stream.getTracks().forEach(t => t.stop()); } catch {}
    openProfile();
  }, 40000);
};

// ==================== showPixAlert ====================
function showPixAlert() {
  const overlay = document.createElement("div");
  overlay.style = "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;";
  overlay.innerHTML = `
    <div style="width:270px;background:#2c2c2e;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont;color:#fff;text-align:center;">
      <div style="padding:18px 16px;font-size:16px;line-height:1.3;">A chave Pix de ${CONTACT.name} não está disponível.</div>
      <div style="display:flex;border-top:1px solid rgba(255,255,255,0.1);">
        <div id="pixLearnMore" style="flex:1;padding:14px 0;color:#34c759;font-weight:500;cursor:pointer;">Saiba mais</div>
        <div style="width:1px;background:rgba(255,255,255,0.1);"></div>
        <div id="pixOk" style="flex:1;padding:14px 0;color:#34c759;font-weight:600;cursor:pointer;">OK</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#pixOk").onclick      = () => document.body.removeChild(overlay);
  overlay.querySelector("#pixLearnMore").onclick = () => document.body.removeChild(overlay);
}

// ==================== SCROLL / TYPING ====================
function scrollToBottom() {
  // RAF prevents WebKit GPU black square; setTimeout(50) ensures iOS layout has settled.
  // Também resincroniza a base do gesto de scroll-pra-fechar-teclado — sem
  // isso, uma mensagem chegando aqui move o scrollTop mas deixa a
  // referência do gesto desatualizada (ver ScrollController.syncGestureBaseline).
  requestAnimationFrame(() => {
    const el = state.chatEl;
    if (el) el.scrollTop = el.scrollHeight;
    ScrollController.syncGestureBaseline();
  });
  setTimeout(() => {
    const el = state.chatEl;
    if (el) el.scrollTop = el.scrollHeight;
    ScrollController.syncGestureBaseline();
  }, 50);
}

// Funil roteirizado, não é um chat real de ida-e-volta livre — a conversa
// sempre tem que estar ancorada na última mensagem, independente de onde o
// lead deixou o scroll ou o que ele tocou (por isso não existe mais gate de
// "só rola se já estava perto do fim").
function scrollBottom() {
  if (!state.chatEl) return;
  scrollToBottom();
}

// Só rola sozinho se o lead já estiver perto do final — digitando/mensagem/
// mídia chegando não pode puxar o scroll de quem subiu pra ler o histórico
// (mesmo comportamento do WhatsApp/Telegram de verdade). Mensagem/ação do
// próprio lead (ex.: enviar) continua usando scrollBottom() sem essa trava.
function isNearBottom(thresholdPx = 120) {
  const el = state.chatEl;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}
function scrollBottomIfNear() {
  if (isNearBottom()) scrollBottom();
}

// ==================== RESPONDER MENSAGEM (swipe, estilo WhatsApp) ====================
// O lead arrasta uma bolha da Susana pro lado pra marcar "respondendo a
// ela" — só as mensagens dela são arrastáveis (ver attachSwipeToReply);
// as próprias mensagens do lead não têm esse gesto. _replyTarget guarda
// só o essencial pra desenhar a citação (lado + texto de preview), não uma
// referência ao item original — não precisa navegar/rolar até ele.
let _replyTarget = null;

function htmlPreviewToText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, " ");
  return (tmp.textContent || "").trim();
}

function getItemPreviewText(item) {
  switch (item.type) {
    case "msg":       return htmlPreviewToText(item.html);
    case "video":     return `📹 ${item.title || "Vídeo"}`;
    case "photo":     return `📷 ${item.title || "Foto Privada"}`;
    case "img":       return "📷 Foto";
    case "mediaGrid": return "📷 Fotos";
    case "audio":     return "🎤 Mensagem de voz";
    case "cta":       return "📄 Anúncio";
    default:          return "";
  }
}

function setReplyTarget(item) {
  _replyTarget = { side: item.side, text: getItemPreviewText(item) };
  renderReplyPreviewBar();
}

function clearReplyTarget() {
  if (!_replyTarget) return;
  _replyTarget = null;
  renderReplyPreviewBar();
}

function renderReplyPreviewBar() {
  const bar = document.getElementById("replyPreviewBar");
  if (!bar) return;
  if (!_replyTarget) { bar.classList.add("is-hidden"); bar.innerHTML = ""; return; }
  const label = _replyTarget.side === "left" ? (CONTACT.name || "Susana") : "Você";
  bar.classList.remove("is-hidden");
  bar.innerHTML = `
    <div class="replyPreviewAccent"></div>
    <div class="replyPreviewBody">
      <div class="replyPreviewLabel">${escapeHtml(label)}</div>
      <div class="replyPreviewText">${escapeHtml(_replyTarget.text)}</div>
    </div>
    <button class="replyPreviewClose" type="button" aria-label="Cancelar resposta">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8696a0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>
    </button>
  `;
  bar.querySelector(".replyPreviewClose").addEventListener("click", clearReplyTarget);
}

function renderReplyQuoteHTML(replyTo) {
  if (!replyTo) return "";
  const label = replyTo.side === "left" ? (CONTACT.name || "Susana") : "Você";
  return `
    <div class="replyQuote">
      <div class="replyQuoteLabel">${escapeHtml(label)}</div>
      <div class="replyQuoteText">${escapeHtml(replyTo.text)}</div>
    </div>`;
}

const SWIPE_REPLY_THRESHOLD = 60; // px de arraste pra confirmar o gesto, estilo WhatsApp
const SWIPE_REPLY_MAX = 76;       // teto de arraste visual (efeito "elástico")

// Só chamado pra bolhas da Susana (side "left") — ver decisão de escopo.
// Detecção de direção: só intercepta (preventDefault) quando o arraste é
// claramente horizontal; se for vertical, solta o gesto pro scroll nativo
// do chat continuar funcionando normalmente (inclusive o gesto de puxar o
// scroll pra fechar o teclado, que roda no elemento pai).
function attachSwipeToReply(row, item) {
  const bubble = row.querySelector(".bubble");
  if (!bubble) return;
  let startX = 0, startY = 0, dragging = false, locked = null;

  function reset() {
    dragging = false; locked = null;
    bubble.style.transition = "transform .2s ease";
    bubble.style.transform = "";
    setTimeout(() => { bubble.style.transition = ""; }, 210);
  }

  row.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    locked = null;
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (!dragging || !e.touches || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (locked !== "h") return;

    e.preventDefault();
    const clamped = Math.max(0, Math.min(SWIPE_REPLY_MAX, dx));
    bubble.style.transform = `translateX(${clamped}px)`;
  }, { passive: false });

  row.addEventListener("touchend", (e) => {
    if (!dragging) return;
    const t = e.changedTouches && e.changedTouches[0];
    const dx = t ? t.clientX - startX : 0;
    if (locked === "h" && dx >= SWIPE_REPLY_THRESHOLD) {
      vibrate(10);
      setReplyTarget(item);
    }
    reset();
  }, { passive: true });

  row.addEventListener("touchcancel", reset, { passive: true });
}

// rastreia se um gisaSay() está no meio da fase "digitando", pra poder
// reconstruir o indicador se o chat for remontado nesse meio-tempo (ex.:
// pessoa foi no perfil/stories e voltou) — sem isso, addTyping() tinha
// adicionado o balão no #chat antigo (destruído pelo mountChat()), e a
// mensagem caía sem nenhum "digitando..." visível antes dela.
let _typingActive = false;

function removeTyping() {
  _typingActive = false;
  const el = document.getElementById("typingRow");
  if (el) el.remove();
}

function addTyping() {
  removeTyping();
  _typingActive = true;
  const row = document.createElement("div");
  row.className = "msgRow msg-left is-single";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="bubble bubble-in bubble-typing">
      <div class="typingDots">
        <span class="dotWrap"><span class="dot"></span></span>
        <span class="dotWrap"><span class="dot"></span></span>
        <span class="dotWrap"><span class="dot"></span></span>
      </div>
    </div>
  `;
  state.chatEl.appendChild(row);
  scrollBottomIfNear();
}

// ==================== RENDER ====================
function pushHistory(item) {
  state.history.push(item);
  if (state.history.length > 260) state.history = state.history.slice(-260);
  saveState();
}

function renderTicks(item) {
  if (item.side !== "right") return "";
  // item.seen === false: ela tá "visto por último" (saiu/away) — tick cinza
  // (entregue, não visualizada); qualquer outro valor mantém o azul de sempre.
  const color = item.seen === false ? "#8696a0" : "#53bdeb";
  return `<svg class="tickSvg" width="17" height="11" viewBox="0 0 17 11" fill="none" aria-hidden="true">
    <path d="M1 5.5L4 9L9.5 1.5" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6 5.5L9 9L14.5 1.5" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderMeta(item) {
  return `<span class="meta"><span class="metaTime">${item.time || nowTime()}</span>${renderTicks(item)}</span>`;
}

function renderMediaGrid(item) {
  const items = Array.isArray(item.items) ? item.items : getDefaultGridItems();
  return `
    <div class="mediaGrid">
      ${items.map((m, index) => `
        <div class="mediaGridItem" data-index="${index}">
          <img src="${m.src}" alt="" onerror="this.style.display='none'" />
          <div class="mediaGridOverlay"><span class="mediaPlay"></span></div>
          <div class="mediaDuration">${m.duration || "0:08"}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAudioBubble(item) {
  const bars = Array.isArray(item.bars) && item.bars.length ? item.bars : getDefaultWaveBars();
  const dur  = item.duration || "0:00";
  const time = item.time || nowTime();
  return `
    <div class="audioBubbleShell">
      <div class="audioMainRow">
        <button class="audioPlayBtn" type="button" aria-label="Play">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,.88)">
            <polygon points="6,4 21,12 6,20"/>
          </svg>
        </button>
        <div class="audioWaveRow">
          <span class="audioProgressDot"></span>
          <div class="audioWave">
            ${bars.map(h => `<span class="waveBar" style="height:${Math.max(3,Math.min(h,30))}px"></span>`).join("")}
          </div>
        </div>
        <div class="audioAvatarWrap">
          <div class="audioAvatarMini">
            <img src="${ASSETS.avatar}?v=1" alt="" style="object-position:top;" onerror="this.style.display='none'" />
          </div>
          <span class="audioMicBadge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="11" rx="3" fill="#53bdeb"/>
              <path d="M5 10a7 7 0 0 0 14 0" stroke="#53bdeb" stroke-width="2.2" stroke-linecap="round"/>
              <line x1="12" y1="19" x2="12" y2="22" stroke="#53bdeb" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </span>
        </div>
      </div>
      <div class="audioFooterRow">
        <span data-audio-dur>${dur}</span>
        <span>${time}</span>
      </div>
    </div>
  `;
}

function renderRowHTML(item, animated = false) {
  const sideClass  = item.side === "right" ? "msg-right" : "msg-left";
  const cluster    = `is-${item.cluster || "single"}`;
  const bubbleBase = item.side === "right" ? "bubble-out" : "bubble-in";
  const anim       = animated ? "popIn" : "";

  if (item.type === "msg") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} ${anim}">
        ${renderReplyQuoteHTML(item.replyTo)}
        <div class="bubbleRow"><div class="bubbleText">${item.html}</div>${renderMeta(item)}</div>
      </div>
    </div>`;

  if (item.type === "video") {
    const title = item.title || "Vídeo";
    const dur = item.duration || "0:00";
    return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-videoCard ${anim}">
        <div class="videoCard">
          <div class="videoCardHeader">
            <span class="videoCardTitle">${escapeHtml(title)}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,.45)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="videoCardThumb">
            <video data-vdur${item.autoplay ? " data-autoplay" : ""} playsinline muted preload="auto" src="${item.src}"></video>
            ${item.autoplay ? "" : `<div class="videoCardPlay"><svg width="21" height="21" viewBox="0 0 24 24" fill="white"><polygon points="7,4 21,12 7,20"/></svg></div>`}
          </div>
          <div class="videoCardFooter">
            <div class="videoCardDur">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="4" width="13" height="16" rx="2" fill="rgba(255,255,255,.65)"/>
                <path d="M15 9l7-3.5v13L15 15V9z" fill="rgba(255,255,255,.65)"/>
              </svg>
              <span data-dur-text>${dur}</span>
            </div>
            ${renderMeta(item)}
          </div>
        </div>
      </div>
    </div>`;
  }

  if (item.type === "img") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-media ${anim}">
        <div class="imgBubble">
          <img src="${item.src}" alt="" style="width:100%;display:block;border-radius:inherit;" onerror="this.style.display='none'" />
        </div>${renderMeta(item)}
      </div>
    </div>`;

  if (item.type === "mediaGrid") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-grid ${anim}">
        ${renderMediaGrid(item)}${renderMeta(item)}
      </div>
    </div>`;

  if (item.type === "photo") {
    const title = item.title || "Foto Privada";
    return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-videoCard ${anim}">
        <div class="videoCard">
          <div class="videoCardHeader">
            <span class="videoCardTitle">${escapeHtml(title)}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="rgba(255,255,255,.45)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="videoCardThumb" data-photo-src="${item.src}">
            <img src="${item.src}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none'" />
          </div>
          <div class="videoCardFooter" style="justify-content:flex-end;">
            ${renderMeta(item)}
          </div>
        </div>
      </div>
    </div>`;
  }

  if (item.type === "audio") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-audio ${anim}">
        ${renderAudioBubble(item)}
      </div>
    </div>`;

  if (item.type === "cta") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-card ${anim}">
        ${item.html}${renderMeta(item)}
      </div>
    </div>`;

  return "";
}

function renderItem(item, animated = false) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderRowHTML(item, animated).trim();
  const row = wrapper.firstElementChild;
  if (row) {
    const typingRow = document.getElementById("typingRow");
    if (typingRow) {
      state.chatEl.insertBefore(row, typingRow);
    } else {
      state.chatEl.appendChild(row);
    }
    // só as mensagens da Susana são arrastáveis pra responder — ver decisão
    // de escopo do recurso (o lead não arrasta as próprias mensagens).
    if (item.side === "left") attachSwipeToReply(row, item);

    const vid = row.querySelector("[data-vdur]");
    if (vid) {
      const durText = row.querySelector("[data-dur-text]");

      // detect duration — skip for autoplay videos that have a fixed fake duration
      const onMeta = () => {
        if (vid.hasAttribute("data-autoplay")) return;
        if (durText && vid.duration && isFinite(vid.duration)) {
          const s = Math.floor(vid.duration);
          durText.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        }
      };
      vid.addEventListener("loadedmetadata", onMeta, { once: true });

      vid.muted = true;
      if (vid.hasAttribute("data-autoplay")) {
        vid.loop = true;
        vid.play().catch(() => {});
      } else {
        // show first frame then pause
        vid.play().then(() => {
          vid.pause();
          try { vid.currentTime = 0.01; } catch {}
        }).catch(() => {
          try { vid.currentTime = 0.01; } catch {}
        });
      }

      // tap anywhere on card → fullscreen play with sound
      const card = row.querySelector(".videoCard");
      if (card) {
        card.style.cursor = "pointer";
        card.addEventListener("click", () => {
          vid.muted = false;
          if (vid.webkitEnterFullscreen) {
            vid.webkitEnterFullscreen();
          } else if (vid.requestFullscreen) {
            vid.requestFullscreen();
          }
          vid.play().catch(() => {});
        }, { once: false });
      }
    }

    // audio: playback + duration detect + waveform animation
    if (item.type === "audio" && item.src) {
      const durEl   = row.querySelector("[data-audio-dur]");
      const playBtn = row.querySelector(".audioPlayBtn");
      const waveBars = Array.from(row.querySelectorAll(".waveBar"));

      const audio = new Audio(item.src);
      let playing = false;
      let rafId   = null;

      const playIcon  = `<svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,.88)"><polygon points="6,4 21,12 6,20"/></svg>`;
      const pauseIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,.88)"><rect x="5" y="4" width="4" height="16" rx="1"/><rect x="15" y="4" width="4" height="16" rx="1"/></svg>`;

      function updateWave() {
        if (!audio.duration || !isFinite(audio.duration)) { rafId = requestAnimationFrame(updateWave); return; }
        const progress = audio.currentTime / audio.duration;
        const played = Math.floor(progress * waveBars.length);
        waveBars.forEach((b, i) => b.classList.toggle("isPlayed", i < played));
        rafId = requestAnimationFrame(updateWave);
      }

      function stopWave() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      }

      audio.addEventListener("loadedmetadata", () => {
        if (durEl && audio.duration && isFinite(audio.duration)) {
          const s = Math.floor(audio.duration);
          durEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        }
      }, { once: true });

      audio.addEventListener("ended", () => {
        playing = false;
        stopWave();
        waveBars.forEach(b => b.classList.remove("isPlayed"));
        if (playBtn) playBtn.innerHTML = playIcon;
      });

      if (playBtn) {
        // preventDefault no mousedown impede o iOS de tirar foco do input (fecha teclado)
        playBtn.addEventListener("mousedown", (e) => {
          if (document.activeElement?.id === "input") e.preventDefault();
        });
        playBtn.addEventListener("click", () => {
          if (playing) {
            audio.pause();
            playing = false;
            stopWave();
            if (playBtn) playBtn.innerHTML = playIcon;
          } else {
            audio.play().catch(() => {});
            playing = true;
            if (playBtn) playBtn.innerHTML = pauseIcon;
            rafId = requestAnimationFrame(updateWave);
          }
        });
      }
    }
  }
  return row;
}

function restoreHistory() {
  if (!state.chatEl || !Array.isArray(state.history)) return;
  state.chatEl.innerHTML = "";
  for (const item of state.history) renderItem(item, false);
  scrollBottom();
}

// aviso de sistema (estilo "conversa protegida" do WhatsApp) — só na
// primeira entrada no chat, não faz parte do histórico persistido.
function insertSystemNotice(text) {
  const chat = document.getElementById("chat");
  if (!chat) return;
  const el = document.createElement("div");
  el.className = "sysNotice";
  el.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <span>${text}</span>
  `;
  chat.appendChild(el);
}

function addMsg(side, html, replyTo = null) {
  updatePreviousGroupForNewMessage(side);
  const item = { type:"msg", side, html, time:nowTime(), cluster:getNewCluster(side), replyTo };
  // mensagens do lead mandadas enquanto ela tá "visto por último" (away)
  // nascem marcadas como não vistas — ver markPendingMessagesSeen().
  if (side === "right") item.seen = !!state.flags.botOnline;
  pushHistory(item); renderItem(item, true);
  // Mensagem própria do lead sempre rola (ação dele); mensagem que chega
  // (dela) só rola se ele já estava perto do final.
  if (side === "right") scrollBottom(); else scrollBottomIfNear();
  // som de notificação só pra mensagens que chegam (dela) — igual o
  // WhatsApp não toca esse som pras suas próprias mensagens enviadas.
  if (side === "left") waPlayMessagePop();
}

// Chamada quando ela volta a ficar "online" depois de um período away —
// vira pra azul o tick de toda mensagem do lead que ficou pendente nesse
// meio-tempo, igual o WhatsApp faz quando a outra pessoa finalmente abre o
// chat e vê tudo de uma vez.
function markPendingMessagesSeen() {
  let changed = false;
  for (const item of state.history) {
    if (item.type === "msg" && item.side === "right" && item.seen === false) {
      item.seen = true;
      changed = true;
    }
  }
  if (!changed) return;
  saveState();
  const chat = state.chatEl;
  if (!chat) return;
  chat.querySelectorAll(".msg-right .tickSvg path").forEach(p => p.setAttribute("stroke", "#53bdeb"));
}

function addVideoBubble(src, title = "Vídeo") {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"video", side:"left", src:`${src}?v=${Date.now()}`, title, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
  waPlayMessagePop();
}

async function gisaSendVideo(src, title = "Vídeo") {
  setStatus("enviando um vídeo…");
  await sleep(rand(3000, 5000));
  setStatus("");
  await sleep(rand(80, 180));
  addVideoBubble(src, title);
}

async function gisaAutoPlayVideo(src) {
  // 3s pause → status "enviando vídeo…" → 5s → video drops and autoplays
  let row = null;
  try {
    await sleep(3000);
    setStatus("enviando vídeo…");
    await sleep(5000);
    setStatus("");
    await sleep(rand(80, 160));

    const item = { type:"video", side:"left", src:`${src}?v=${Date.now()}`, title:"Vídeo Privado", autoplay:true, duration:"3:00", time:nowTime(), cluster:"single" };
    row = renderItem(item, true);
    scrollBottomIfNear();
    waPlayMessagePop();

    // t=5s after video drop: replace video with deleted-message bubble (WhatsApp style)
    await sleep(5000);
    if (row && row.parentNode) {
      const vid = row.querySelector("video");
      if (vid) { vid.pause(); vid.src = ""; vid.load(); }
      const bubble = row.querySelector(".bubble");
      if (bubble) {
        bubble.classList.add("bubble-deleted");
        bubble.classList.remove("bubble-videoCard");
        bubble.style.width = "";
        bubble.innerHTML = `<span class="deleted-msg"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Esta mensagem foi apagada</span>`;
        bubble.style.opacity = "0";
        bubble.style.transition = "";
        requestAnimationFrame(() => {
          bubble.style.transition = "opacity 0.3s ease";
          bubble.style.opacity = "1";
        });
      }
    }

    // typing appears only after message is deleted
    setStatus("digitando…");
    addTyping();
    await sleep(rand(1200, 2000)); // pausa de assentamento antes do próximo gisaSay
  } catch(e) {
    if (row && row.parentNode) row.remove();
    removeTyping();
    throw e;
  }
}

function addPhotoCardBubble(src, title = "Foto Privada") {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"photo", side:"left", src:`${src}?v=${Date.now()}`, title, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
  waPlayMessagePop();
}

// Visualizador de foto em tela cheia, estilo WhatsApp — abre com fade,
// fecha tocando fora/no X, ou arrastando a foto pra baixo (solta se
// arrastar o suficiente, senão volta pro lugar).
function openPhotoViewer(src) {
  const overlay = document.createElement("div");
  overlay.className = "photoViewerOverlay";
  overlay.innerHTML = `<img src="${src}" class="photoViewerImg" alt="" />`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("photoViewerOverlay-visible"));

  const img = overlay.querySelector(".photoViewerImg");
  let cleaned = false;
  function close() {
    if (cleaned) return;
    cleaned = true;
    overlay.classList.remove("photoViewerOverlay-visible");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 350); // rede de segurança
  }
  // Só fecha tocando fora da foto (sem X) ou arrastando pra baixo (ver
  // touchend). Dar zoom (pinça) não conta como "fora".
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // Estado de zoom/pan (pinça com 2 dedos) e arrastar-pra-fechar (1 dedo,
  // só quando não tem zoom ativo — evita brigar com o pan de 1 dedo numa
  // foto já ampliada).
  let scale = 1, panX = 0, panY = 0;
  let pinchStartDist = 0, pinchStartScale = 1;
  let panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
  let dragStartY = null, dragY = 0;
  let mode = null; // "pinch" | "pan" | "drag" | null

  function applyTransform() {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
  function dist(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  img.addEventListener("touchstart", (e) => {
    img.style.transition = "";
    if (e.touches.length === 2) {
      mode = "pinch";
      pinchStartDist = dist(e.touches[0], e.touches[1]);
      pinchStartScale = scale;
    } else if (e.touches.length === 1) {
      if (scale > 1.02) {
        mode = "pan";
        panStartX = e.touches[0].clientX; panStartY = e.touches[0].clientY;
        panOrigX = panX; panOrigY = panY;
      } else {
        mode = "drag";
        dragStartY = e.touches[0].clientY;
        dragY = 0;
      }
    }
  }, { passive: true });

  img.addEventListener("touchmove", (e) => {
    if (mode === "pinch" && e.touches.length === 2) {
      const d = dist(e.touches[0], e.touches[1]);
      scale = Math.min(4, Math.max(1, pinchStartScale * (d / pinchStartDist)));
      applyTransform();
    } else if (mode === "pan" && e.touches.length === 1) {
      panX = panOrigX + (e.touches[0].clientX - panStartX);
      panY = panOrigY + (e.touches[0].clientY - panStartY);
      applyTransform();
    } else if (mode === "drag" && e.touches.length === 1 && dragStartY !== null) {
      dragY = Math.max(0, e.touches[0].clientY - dragStartY);
      img.style.transform = `translateY(${dragY}px) scale(${Math.max(0.7, 1 - dragY / 700)})`;
      overlay.style.background = `rgba(0,0,0,${Math.max(0, 0.92 - dragY / 400)})`;
    }
  }, { passive: true });

  img.addEventListener("touchend", (e) => {
    if (mode === "drag") {
      if (dragY > 120) { close(); return; }
      img.style.transition = "transform .25s ease";
      img.style.transform = "";
      overlay.style.background = "";
      dragY = 0;
    } else if (mode === "pinch" || mode === "pan") {
      // volta pro tamanho normal se soltou quase sem zoom
      if (scale <= 1.02) {
        scale = 1; panX = 0; panY = 0;
        img.style.transition = "transform .2s ease";
        applyTransform();
      }
    }
    if (e.touches.length === 0) mode = null;
  });
}

async function gisaSendPhoto(src, title = "Foto Privada") {
  setStatus("enviando uma foto…");
  await sleep(rand(2000, 4000));
  setStatus("");
  await sleep(rand(80, 180));
  addPhotoCardBubble(src, title);
}

// Simula "ela saiu pra tirar a foto agora": fica "visto por último" (away)
// por awayMs antes de voltar e mandar.
async function gisaSendPhotoAway(src, title = "Foto Privada", awayMs = 7000) {
  state.flags.botOnline = false; saveState();
  const awayAt = new Date();
  setStatus(`visto por último às ${String(awayAt.getHours()).padStart(2,"0")}:${String(awayAt.getMinutes()).padStart(2,"0")}`);
  await sleep(awayMs);
  state.flags.botOnline = true; saveState();
  markPendingMessagesSeen();
  setStatus("online");
  await sleep(2000);
  setStatus("enviando uma foto…");
  await sleep(1000);
  setStatus("");
  await sleep(rand(80, 180));
  addPhotoCardBubble(src, title);
}

function addImgBubble(src) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"img", side:"left", src:`${src}?v=${Date.now()}`, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
  waPlayMessagePop();
}

function addMediaGridBubble(items = null) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"mediaGrid", side:"left", items:items||getDefaultGridItems(), time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
  waPlayMessagePop();
}

function addAudioBubble(data = {}) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"audio", side:"left", src:data.src||"", bars:data.bars||getDefaultWaveBars(), duration:data.duration||"0:00", time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
  waPlayMessagePop();
}

async function gisaSendAudio(src, bars = null, recordMs = null) {
  setStatus("gravando áudio…");
  await sleep(recordMs ?? rand(3000, 5000));
  setStatus("");
  await sleep(rand(80, 160));
  addAudioBubble({ src, bars: bars || getDefaultWaveBars() });
  await sleep(3000);
}

function addCtaCard(html) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"cta", side:"left", html, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottomIfNear();
}

function typingDelayFor(text) {
  const len = String(text).length;
  return Math.min(6200, rand(850,1450) + len * rand(28,50) + rand(220,920));
}

async function gisaSay(text, opts = {}) {
  const status = "digitando…";
  setStatus(status); addTyping();
  // O tempo de digitação nunca fica abaixo do que o tamanho do texto pede —
  // um "delay" fixo passado em opts vira só um PISO (útil pra pausas
  // dramáticas propositalmente mais longas que o texto), nunca um teto que
  // deixa uma mensagem longa parecer digitada instantaneamente.
  await sleep(Math.max(opts.delay ?? 0, typingDelayFor(text)));
  removeTyping(); await sleep(rand(90,220));
  setStatus(CONTACT.subtitle ?? "");
  addMsg("left", escapeHtml(text).replace(/\n/g,"<br/>"), opts.replyTo || null);
  if (!opts.noSleep) await sleep(rand(320,760));
}

function onSend() {
  const input  = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const micBtn  = document.getElementById("composerMic");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autoGrowComposer(input);
  sendBtn.classList.add("is-hidden");
  micBtn.classList.remove("is-hidden");
  FocusGateway.requestFocus(); // keep keyboard open after send, like WhatsApp
  const replyTo = _replyTarget;
  clearReplyTarget();
  addMsg("right", escapeHtml(text), replyTo);
  handleUserText(text);
}

// ==================== SCRIPT FLOW ====================
let _flowRunning = false;

function clearReengage() {
  if (state._t1) { clearTimeout(state._t1); state._t1 = null; }
  if (state._t2) { clearTimeout(state._t2); state._t2 = null; }
  _sleepGen++; // cancel all pending sleeps in previous flows
}

// Classifica a resposta do lead à abertura em uma das 5 categorias do
// roteiro (quente/curioso/timido/curto/frio) — a categoria fica travada em
// state.leadCategory e reaproveitada em todas as ramificações seguintes
// (seção 2, 3 e 5), não é reclassificada a cada mensagem.
function classifyLeadReply(text) {
  const t = String(text || "").toLowerCase();

  const frioWords = [
    "fake", "grátis", "gratis", "quantos anos", "otári", "prova que",
    "é real", "e real", "golpe", "vc é real", "voce e real",
  ];
  if (frioWords.some((w) => t.includes(w))) return "frio";

  const quenteWords = [
    "goz", "buceta", "boceta", "xoxota", "xota", "pica", "pau", "rola",
    "fode", "foder", "fuder", "duro", "arreg", "comer", "meter", "mete",
    "chupa", "chupar", "socar", "penetr", "tesao", "tesão",
  ];
  if (quenteWords.some((w) => t.includes(w))) return "quente";

  const timidoWords = [
    "linda", "bonita", "gata", "maravilhosa", "fofa", "adoro", "tudo bem",
    "oi ", "pode ser", "gostei da foto", "gostei de voce", "gostei de você",
  ];
  if (timidoWords.some((w) => t.includes(w))) return "timido";

  const wordCount = t.trim().split(/\s+/).filter(Boolean).length;
  const continueSignals = ["ver", "mostra", "continua", "mais", "como"];
  if (wordCount <= 2 && !continueSignals.some((w) => t.includes(w))) return "curto";

  return "curioso";
}

const SCRIPT_BRANCHES = {
  quente: {
    section2: {
      msg1: "caralho…\ndo jeito que cê falou já me deixou molhada kkk",
      away: 6500,
      msg2: "olha o que você me fez vestir…\nagora fala direito o que cê quer que eu faça com ela",
    },
    section3: {
      msg1: "porra… cê não tem freio nenhum né",
      msg2: "agora me responde…\nprefere que eu continue te provocando\nou quer que eu te ligue agora pra cê me ver gozando de verdade?",
    },
    section5: {
      msg1: "caralho…\nvocê me deixou encharcada",
      msg2: "eu tenho coisas muito piores guardadas…\nquer que eu te mostre o resto agora?",
    },
  },
  curioso: {
    section2: {
      msg1: "hmm… gostei da sua sinceridade",
      away: 5500,
      msg2: "olha o que eu acabei de colocar só pra você…\nquer que eu tire devagarzinho ou prefere que eu arranque?",
    },
    section3: {
      msg1: "você tá me deixando com uma vontade…",
      msg2: "fala pra mim…\nquer que eu te ligue e olhe nos seus olhos enquanto eu me mostro?",
    },
    section5: {
      msg1: "nossa…\nvocê me deixou sem jeito",
      msg2: "eu quase nunca faço chamada assim…\ntenho muito mais pra te mostrar\nquer ver o que eu não posto em lugar nenhum?",
    },
  },
  timido: {
    section2: {
      msg1: "ai que fofo…\nmas eu não sou mocinha não viu",
      away: 6000,
      msg2: "olha isso…\nagora me fala a verdade\nvocê quer me ver sem nada?",
    },
    section3: {
      msg1: "você é todo certinho…\nmas eu senti que cê quer",
      msg2: "me deixa te ligar?\nquero ver sua cara quando eu tirar tudo",
    },
    section5: {
      msg1: "você me deixou nervosa…\nde um jeito bom",
      msg2: "eu tenho um lado bem mais safado que quase ninguém vê\nquer que eu te mostre?",
    },
  },
  curto: {
    section2: {
      msg1: "só isso?\nfala direito pra mim",
      away: 5000,
      msg2: "você quer me ver pelada\nou tá só enrolando?",
    },
    section3: {
      msg1: "cê é econômico com palavra né…",
      msg2: "para de enrolar\nposso te ligar agora ou vai continuar só mandando \"sim\"?",
    },
    section5: {
      msg1: "você me deixou assim e agora some?",
      msg2: "eu tenho muito mais\nquer ver ou vai ficar só na vontade?",
    },
  },
  frio: {
    section2: {
      msg1: "pode ficar tranquilo que eu não sou fake\nmas eu também não fico me exibindo de graça pra qualquer um",
      away: 4000,
      msg2: "quer ver de verdade\nou prefere ficar só imaginando?",
    },
    section3: {
      msg1: "tudo bem\neu não fico insistindo",
      msg2: "última chance de me ver de verdade\nposso te ligar ou prefere que eu passe pra outro?",
    },
    section5: {
      msg1: "viu que não era fake?",
      msg2: "eu tenho bem mais coisa…\nmas só mostro pra quem realmente entra\nquer o acesso ou prefere ficar de fora?",
    },
  },
};

// Cria um botão inline no chat (mesmo visual usado no resto do app) — a
// única forma de avançar certos pontos do roteiro. Antes essa função era
// chamada mas nunca tinha sido definida (bug real: o clique "Quero ver
// tudo" nunca aparecia e o fluxo travava em silêncio logo após a 1ª
// resposta do lead).
let _advanceBtnSeq = 0;
function showAdvanceButton(label, onClick) {
  const id = `advanceBtn${++_advanceBtnSeq}`;
  addCtaCard(`
    <button type="button" id="${id}" style="
      width:100%;padding:14px 18px;border-radius:14px;border:none;
      background:linear-gradient(135deg,#00e676 0%,#00c853 55%,#009624 100%);
      color:#fff;font-size:15px;font-weight:800;letter-spacing:.2px;
      cursor:pointer;-webkit-tap-highlight-color:transparent;
      box-shadow:0 4px 18px rgba(0,200,83,.4);
    ">${escapeHtml(label)}</button>
  `);
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => {
      btn.disabled = true; btn.style.opacity = "0.6";
      onClick();
    }, { once: true });
  }, 0);
}

// SEÇÃO 2 — resposta à abertura. Classifica o lead uma única vez aqui;
// as seções seguintes (3 e 5) só reaproveitam state.leadCategory.
async function enterOpeningReply(text = null) {
  clearReengage();
  const category = classifyLeadReply(text);
  state.leadCategory = category;
  state.step = 2; saveState();
  trackEvent("MINIAPP_STEP_TEASE_BUILDUP");
  trackEvent("MINIAPP_LEAD_CATEGORY_" + category.toUpperCase());
  const branch = SCRIPT_BRANCHES[category].section2;

  await sleep(rand(2000, 3000));
  await gisaSay(branch.msg1, { delay: 2500, replyTo: text ? { side: "right", text } : null });
  await sleep(rand(300, 600));
  await gisaSendPhotoAway(ASSETS.lingerie, "Foto Privada", branch.away);
  await sleep(rand(400, 700));
  await gisaSay(branch.msg2, { delay: 2000, noSleep: true });

  // Seção 6 — "no meio da provocação (3min parado)"
  state._t1 = setTimeout(async () => {
    if (state.step !== 2) return;
    await gisaSay("ainda tá aí ou já bateu e dormiu?");
  }, 3 * 60 * 1000);
}

// SEÇÃO 3 — rodada de provocação: vídeo + pergunta final + botão "Me liga
// agora" (só aparece aqui, nunca antes). Reaproveita a categoria já travada.
async function enterProvocationRound() {
  clearReengage();
  state.step = 3; saveState();
  const category = state.leadCategory || "curioso";
  const branch = SCRIPT_BRANCHES[category].section3;

  await sleep(rand(1500, 2500));
  await gisaSay(branch.msg1, { delay: 2000 });
  await gisaSendVideo(ASSETS.teaseVideo, "Vídeo Privado");
  await sleep(rand(400, 700));
  await gisaSay(branch.msg2, { delay: 2000, noSleep: true });
  showAdvanceButton("Me liga agora 🔥", () => {
    if (state.step !== 3) return;
    _flowRunning = true;
    enterCallReadyTransition().catch(() => {}).finally(() => { _flowRunning = false; });
  });

  // Seção 6 — "depois do vídeo (2min parado sem clicar no botão)"
  state._t1 = setTimeout(async () => {
    if (state.step !== 3) return;
    await gisaSay("sumiu justo agora?\neu tava quase te mostrando tudo");
  }, 2 * 60 * 1000);
}

// Transição curta entre o clique em "Me liga agora" (seção 3) e a chamada
// tocando de fato — cai sozinha, sem esperar mais nenhuma resposta do lead.
async function enterCallReadyTransition() {
  clearReengage();
  state.step = 5; saveState();
  trackEvent("MINIAPP_STEP_CALL_READY");
  await sleep(rand(2000, 3000));
  await gisaSay("tá bom amor, já vou ligar.", { delay: 3000 });
  await sleep(rand(4000, 6000));
  state.declineCount = 0; saveState();
  showIncomingCall();
}

async function enterCallRetry() {
  clearReengage();
  state.step = 5; saveState();
  trackEvent("MINIAPP_STEP_CALL_CONNECTING");
  await gisaSay("vou te dar mais uma chance\nprepara", { delay: 2000 });
  await sleep(rand(800, 1200));
  await gisaSay("arrumando o brinquedinho…", { delay: 1500, noSleep: true });
  await sleep(1000);
 

  // ela "sai pra se arrumar" — 2s depois da mensagem (não instantâneo) é
  // que o status muda pra "visto por último"; fica fora por 8s. Qualquer
  // mensagem que o lead mandar nesse meio-tempo fica marcada como não vista
  // (tick cinza, ver addMsg/renderTicks), só virando "vista" (tick azul)
  // quando ela volta a ficar online. 2s depois de voltar online, "digitando..."
  // reaparece por 3s fixos antes da próxima mensagem.
  await sleep(2000);
  state.flags.botOnline = false; saveState();
  const awayAt = new Date();
  setStatus(`visto por último às ${String(awayAt.getHours()).padStart(2,"0")}:${String(awayAt.getMinutes()).padStart(2,"0")}`);

  await sleep(8000);

  state.flags.botOnline = true; saveState();
  setStatus("online");
  markPendingMessagesSeen();

  await sleep(rand(1200, 1800));
  await gisaSay("estou pronta já\nposso ligar de novo? 😈", { delay: 2000, noSleep: true });
  await sleep(rand(2000, 3000));
  showIncomingCall();
}

function showIncomingCall() {
  trackEvent("MINIAPP_INCOMING_CALL_SHOWN");
  // Força fechar teclado antes de mostrar a tela de chamada
  FocusGateway.requestDismiss();

  // Começa a carregar o vídeo da chamada AGORA — os segundos que o usuário
  // leva pra decidir aceitar são folga de buffer de graça (ver
  // preloadCallVideo/startFunnelCall).
  preloadCallVideo();

  let vibrateInterval = null;
  if (navigator.vibrate) {
    navigator.vibrate([1000, 800, 1000, 800]);
    vibrateInterval = setInterval(() => navigator.vibrate([1000, 800, 1000, 800]), 3600);
  }

  // toque de chamada sintetizado (Web Audio, sem arquivo) — mesmo ciclo de
  // 3.6s da vibração, pra tocar e vibrar juntos como uma chamada de verdade.
  waPlayCallRingTone();
  const ringInterval = setInterval(waPlayCallRingTone, 3600);

  const stopRing = () => {
    try { if (vibrateInterval) clearInterval(vibrateInterval); navigator.vibrate(0); } catch {}
    clearInterval(ringInterval);
  };

  const el = document.createElement("div");
  el.id = "incomingCallScreen";
  el.style.cssText = "position:fixed;inset:0;z-index:9500;background:#1f1f21;display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,sans-serif;padding-top:calc(env(safe-area-inset-top,44px) + 40px);padding-bottom:calc(env(safe-area-inset-bottom,34px) + 28px);user-select:none;";

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:7px;color:rgba(255,255,255,.52);font-size:15px;">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <rect width="24" height="24" rx="5.5" fill="#25d366"/>
          <path d="M12 3c-4.97 0-9 4.03-9 9 0 1.58.41 3.06 1.13 4.35L3 21l4.77-1.12A8.96 8.96 0 0012 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm4.6 12.66c-.19.54-1.13 1.02-1.56 1.06-.42.04-.44.3-2.78-.6-2.81-1.08-4.58-3.94-4.72-4.12-.14-.19-1.08-1.47-1.08-2.8 0-1.33.69-1.98.95-2.27.27-.28.58-.35.77-.35h.54c.17 0 .42-.06.66.51.23.56.79 1.93.86 2.07.07.14.12.3.02.5-.1.2-.15.31-.29.48-.14.17-.3.38-.41.52-.14.15-.28.32-.12.61.16.29.7 1.18 1.5 1.91 1.03.91 1.9 1.2 2.2 1.33.31.13.49.11.66-.08.17-.19.73-.85.93-1.14.19-.28.38-.23.65-.13.27.1 1.71.83 2.01.98.3.15.49.23.56.37.07.13.07.78-.12 1.32z" fill="#fff"/>
        </svg>
        Vídeo de WhatsApp…
      </div>
      <div style="color:#fff;font-size:33px;font-weight:700;letter-spacing:-.6px;margin-top:2px;text-align:center;padding:0 24px;">${CONTACT.name}</div>
    </div>

    <div style="flex:1;"></div>


    <div style="display:flex;align-items:flex-start;justify-content:center;gap:80px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:9px;">
        <button id="callDeclineBtn" style="width:72px;height:72px;border-radius:50%;background:#ff3b30;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <line x1="18" y1="6" x2="6" y2="18" stroke="white" stroke-width="2.8" stroke-linecap="round"/>
            <line x1="6" y1="6" x2="18" y2="18" stroke="white" stroke-width="2.8" stroke-linecap="round"/>
          </svg>
        </button>
        <span style="color:rgba(255,255,255,.8);font-size:14px;">Recusar</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:9px;">
        <button id="callAcceptBtn" style="width:72px;height:72px;border-radius:50%;background:#007aff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <polyline points="20,6 9,17 4,12" stroke="white" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <span style="color:rgba(255,255,255,.8);font-size:14px;">Aceitar</span>
      </div>
    </div>
  `;

  document.body.appendChild(el);

  document.getElementById("callDeclineBtn").onclick = () => {
    trackEvent("MINIAPP_CALL_DECLINE");
    stopRing(); el.remove();
    state.declineCount = (state.declineCount || 0) + 1; saveState();
    (async () => {
      await gisaSay("tá com medo de não aguentar? 🥵", { delay: rand(2000, 3000) });
      if (state.declineCount >= 2) {
        // 2ª recusa — não liga sozinha de novo, só com clique explícito.
        await sleep(rand(1000, 2000));
        await gisaSay("última vez\ndepois eu realmente passo pra outro", { delay: 2000, noSleep: true });
        showAdvanceButton("Me liga agora (última chance)", () => {
          if (state.step < 5) return;
          showIncomingCall();
        });
        return;
      }
      state._t1 = setTimeout(async () => {
        await enterCallRetry();
      }, rand(12000, 15000));
    })();
  };

  document.getElementById("callAcceptBtn").onclick = () => {
    trackEvent("MINIAPP_CALL_ACCEPT");
    stopRing(); el.remove();
    waPlayCallConnected();
    startFunnelCall();
  };
}

async function startFunnelCall() {
  state.step = 5; saveState();
  trackEvent("MINIAPP_FUNNEL_CALL_STARTED");

  const callEl = document.createElement("div");
  callEl.id = "funnelCallScreen";
  callEl.style.cssText = "position:fixed;inset:0;z-index:9000;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;";

  // ── Vídeo principal (dela) fullscreen ──────────────────────────────────────
  // Reaproveita o <video> pré-carregado desde showIncomingCall (mesma
  // técnica de lsPreloadVideo/mountBackgroundVideo) — appendChild MOVE o
  // elemento que já vem baixando/bufferizando há vários segundos, em vez
  // de recriar do zero. Sem cache-bust (?v=Date.now()) — é sempre o mesmo
  // arquivo, então deixamos o browser reaproveitar o que já buscou.
  const preloadedVid = document.getElementById("callVideoPreload");
  let vid;
  if (preloadedVid) {
    vid = preloadedVid;
    vid.removeAttribute("id");
  } else {
    vid = document.createElement("video");
    vid.src = ASSETS.callVideo;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.preload = "auto";
  }
  vid.muted = false; // com som agora — já temos gesto do usuário (aceitou a chamada)
  vid.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;opacity:0;transition:opacity 2s ease;";
  callEl.appendChild(vid);

  // ── Overlay: topo com nome + timer ─────────────────────────────────────────
  const topBar = document.createElement("div");
  topBar.style.cssText = `
    position:absolute;top:0;left:0;right:0;z-index:20;
    padding:calc(env(safe-area-inset-top,44px) + 12px) 16px 20px;
    background:linear-gradient(to bottom,rgba(0,0,0,.55),transparent);
    display:flex;flex-direction:column;align-items:center;gap:3px;
    transition:opacity .25s ease;
  `;
  topBar.innerHTML = `
    <div style="color:#fff;font-size:17px;font-weight:600;letter-spacing:-.3px;">${CONTACT.name}</div>
    <div id="callTimer" style="color:rgba(255,255,255,.8);font-size:14px;">Conectando...</div>
  `;
  callEl.appendChild(topBar);

  // ── Timer — iniciado só após permissão de câmera ───────────────────────────
  let elapsed = 0;
  let timerInterval = null;
  const timerEl = () => callEl.querySelector("#callTimer");
  const startTimer = () => {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      elapsed++;
      const m = Math.floor(elapsed / 60), s = elapsed % 60;
      const t = timerEl(); if (t) t.textContent = m + ":" + String(s).padStart(2,"0");
    }, 1000);
  };

  // ── Barra de controles em baixo ────────────────────────────────────────────
  const bottomBar = document.createElement("div");
  bottomBar.style.cssText = `
    position:absolute;bottom:0;left:0;right:0;z-index:20;
    padding:20px 40px calc(env(safe-area-inset-bottom,34px) + 20px);
    background:linear-gradient(to top,rgba(0,0,0,.6),transparent);
    display:flex;justify-content:space-around;align-items:center;
    transition:opacity .25s ease;
  `;
  bottomBar.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;" id="funnelMuteBtn">
      <div id="funnelMuteBg" style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;transition:background .15s ease;">
        <svg id="funnelMuteIcon" width="26" height="26" viewBox="0 0 24 24" fill="white">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.85-7-7.93H6c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V22h-2v-6.07z"/>
        </svg>
      </div>
      <span style="color:rgba(255,255,255,.75);font-size:12px;">Silenciar</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
      <button id="funnelEndCall" style="width:68px;height:68px;border-radius:50%;background:#ff3b30;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
          <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
        </svg>
      </button>
      <span style="color:rgba(255,255,255,.75);font-size:12px;">Encerrar</span>
    </div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;-webkit-tap-highlight-color:transparent;" id="funnelFlipBtn">
      <div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
        </svg>
      </div>
      <span style="color:rgba(255,255,255,.75);font-size:12px;">Câmera</span>
    </div>
  `;
  callEl.appendChild(bottomBar);

  // ── PiP câmera do lead (canto inferior direito) ────────────────────────────
  const pip = document.createElement("video");
  pip.autoplay = true;
  pip.muted = true;
  pip.playsInline = true;
  pip.setAttribute("playsinline", "");
  pip.style.cssText = `
    position:absolute;
    bottom:calc(env(safe-area-inset-bottom,34px) + 108px);
    right:14px;
    width:88px;height:120px;
    border-radius:14px;
    object-fit:cover;
    border:2px solid rgba(255,255,255,.25);
    background:#111;
    transform:scaleX(-1);
    z-index:15;
    transition:bottom .25s ease;
    display:none;
  `;
  callEl.appendChild(pip);

  document.body.appendChild(callEl);

  // ── tap para esconder/mostrar controles (estilo WhatsApp) ──────
  let _fcVisible = true;
  let _fcTimer = null;
  const _fcHide = () => {
    topBar.style.opacity = "0"; topBar.style.pointerEvents = "none";
    bottomBar.style.opacity = "0"; bottomBar.style.pointerEvents = "none";
    if (pip.style.display !== "none") pip.style.bottom = "calc(env(safe-area-inset-bottom,34px) + 20px)";
    _fcVisible = false;
  };
  const _fcShow = () => {
    topBar.style.opacity = "1"; topBar.style.pointerEvents = "";
    bottomBar.style.opacity = "1"; bottomBar.style.pointerEvents = "";
    if (pip.style.display !== "none") pip.style.bottom = "calc(env(safe-area-inset-bottom,34px) + 108px)";
    _fcVisible = true;
    clearTimeout(_fcTimer);
    _fcTimer = setTimeout(_fcHide, 4000);
  };
  callEl.addEventListener("touchend", (e) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    if (bottomBar.contains(hit) || topBar.contains(hit)) return;
    if (_fcVisible) _fcHide(); else _fcShow();
  }, { passive: true });
  _fcTimer = setTimeout(_fcHide, 4000);

  // readyState >= 3 (HAVE_FUTURE_DATA) = já tem o frame atual + pelo menos
  // o próximo decodificados, o mesmo patamar que dispara o evento
  // "canplay" — abaixo disso, play() ainda pode "engasgar" no primeiro
  // frame. Graças ao preload desde showIncomingCall, isso normalmente já é
  // verdade aqui, então essa promise resolve na hora (não é um delay novo,
  // é uma checagem real que só espera de verdade se genuinamente precisar).
  function videoReady(video) {
    if (video.readyState >= 3) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener("canplay", resolve, { once: true });
    });
  }

  const startMainVideo = () => {
    vid.pause();
    vid.currentTime = 0;

    const minBlackScreen = new Promise((resolve) => setTimeout(resolve, 3500));
    // 3.5s de tela preta com "Conectando..." — dá tempo de parecer que a
    // chamada está mesmo entrando antes da modelo aparecer, em vez de
    // aparecer instantaneamente ao aceitar. A revelação espera as DUAS
    // coisas: esse tempo mínimo E o vídeo genuinamente pronto pra
    // reproduzir. Sem essa garantia, o vídeo aparecia mas ficava
    // "congelado" nos primeiros instantes enquanto ainda bufferizava/
    // decodificava.
    Promise.all([minBlackScreen, videoReady(vid)]).then(() => {
      vid.play().catch(() => {});
      vid.style.opacity = "1";
      const t = timerEl(); if (t) t.textContent = "0:00"; // sai de "Conectando..."
      startTimer();
    });
  };

  // Vídeo principal roda independente da câmera do lead (PiP secundário) —
  // antes, startMainVideo só rodava DEPOIS da resposta de getUserMedia
  // (que pode demorar segundos na primeira vez, com o diálogo nativo de
  // permissão), atrasando o vídeo principal por um motivo que não tinha
  // nada a ver com ele.
  startMainVideo();

  let camStream = null;
  if (navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(s => { camStream = s; pip.srcObject = s; pip.style.display = ""; pip.play().catch(() => {}); })
      .catch(() => {});
  } else {
    pip.style.display = "none";
  }

  const cleanup = () => {
    clearInterval(timerInterval);
    try { if (camStream) camStream.getTracks().forEach(t => t.stop()); } catch {}
  };

  let done = false;
  const triggerPaywall = async () => {
    if (done) return; done = true;
    cleanup();
    callPlayEndTone();

    try { vid.pause(); vid.src = ""; } catch {}

    // ── "Chamada encerrada" overlay (estilo WhatsApp) ───────────────
    const m = Math.floor(elapsed / 60), s = elapsed % 60;
    const durStr = m + ":" + String(s).padStart(2, "0");
    const endOverlay = document.createElement("div");
    endOverlay.style.cssText = "position:absolute;inset:0;z-index:50;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;opacity:0;transition:opacity 0.25s ease;pointer-events:none;";
    endOverlay.innerHTML = `
      <div style="color:#fff;font-size:17px;font-weight:600;letter-spacing:-.2px;">Chamada encerrada</div>
      <div style="color:rgba(255,255,255,.6);font-size:13px;">${durStr}</div>
    `;
    callEl.appendChild(endOverlay);
    requestAnimationFrame(() => { endOverlay.style.opacity = "1"; });

    await sleep(2000);

    // fade out e remove tela de chamada
    callEl.style.transition = "opacity 0.35s ease";
    callEl.style.opacity = "0";
    await sleep(380);
    callEl.remove();

    // bubble WhatsApp de ligação de vídeo no chat
    addCallNotifBubble(elapsed);

    state.step = 6; saveState();
    trackEvent("MINIAPP_CALL_ENDED");
    await doCallPaywall();
  };

  // Botão encerrar
  setTimeout(() => {
    const endBtn = document.getElementById("funnelEndCall");
    if (endBtn) endBtn.onclick = () => { clearTimeout(_fcTimer); triggerPaywall(); };

    // ── Silenciar ───────────────────────────────────────────────────
    let isMuted = false;
    const muteBtn = document.getElementById("funnelMuteBtn");
    const muteBg  = document.getElementById("funnelMuteBg");
    const muteIco = document.getElementById("funnelMuteIcon");
    if (muteBtn) muteBtn.onclick = () => {
      isMuted = !isMuted;
      if (isMuted) {
        muteBg.style.background = "#ffffff";
        muteIco.setAttribute("fill", "#111");
      } else {
        muteBg.style.background = "rgba(255,255,255,.22)";
        muteIco.setAttribute("fill", "white");
      }
    };

    // ── Virar câmera ────────────────────────────────────────────────
    let flipFacing = "user";
    let flipping = false;
    const flipBtn = document.getElementById("funnelFlipBtn");
    if (flipBtn) flipBtn.onclick = async () => {
      if (flipping || !navigator.mediaDevices?.getUserMedia) return;
      flipping = true;
      flipFacing = flipFacing === "user" ? "environment" : "user";
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: flipFacing }, audio: false });
        if (camStream) camStream.getTracks().forEach(t => t.stop());
        camStream = newStream;
        pip.srcObject = newStream;
        pip.play().catch(() => {});
      } catch {}
      flipping = false;
    };
  }, 0);

  vid.addEventListener("ended", triggerPaywall);
  setTimeout(triggerPaywall, 90000);
}

function addCallNotifBubble(seconds) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  const dur = m + ":" + String(s).padStart(2, "0");
  const html = `
    <div style="display:flex;align-items:center;gap:10px;padding:2px 0;">
      <div style="width:38px;height:38px;border-radius:50%;background:rgba(37,211,102,0.18);flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#25d366">
          <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
        </svg>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
        <span style="color:#fff;font-size:14.5px;font-weight:600;line-height:1.2;">Ligação de vídeo</span>
        <span style="color:rgba(255,255,255,.5);font-size:12px;">${dur}</span>
      </div>
    </div>
  `;
  addMsg("left", html);
}

// SEÇÃO 5 — pós-chamada, o momento mais crítico do funil. Reaproveita a
// categoria travada desde a seção 2 (foto residual + 2 mensagens + botão
// "Quero o acesso completo", que dispara a tela de checkout já existente).
async function doCallPaywall() {
  trackEvent("MINIAPP_PAYWALL_SEQUENCE_START");
  state.step = 6; saveState();
  const category = state.leadCategory || "curioso";
  const branch = SCRIPT_BRANCHES[category].section5;

  await sleep(rand(2000, 3000));
  await gisaSendPhoto(ASSETS.teaseCallPhoto, "Foto Privada");
  await sleep(rand(400, 700));
  await gisaSay(branch.msg1, { delay: 2500 });
  await sleep(rand(300, 600));
  await gisaSay(branch.msg2, { delay: 2500, noSleep: true });
  showAdvanceButton("Quero o acesso completo 😈", () => {
    showCheckoutCta();
  });
}

function lockChat() {
  if (document.getElementById("chatLockBar")) return;
  const full = document.querySelector(".full");
  if (!full) return;
  const composer = document.createElement("div");
  composer.id = "chatLockBar";
  composer.style.cssText = "padding:0;display:flex;flex-direction:column;background:var(--topbar);border-top:1px solid rgba(255,255,255,.07);flex-shrink:0;";
  composer.innerHTML = `
    <style>
      @keyframes glowG{0%,100%{box-shadow:0 0 18px rgba(0,230,118,.6),0 4px 16px rgba(0,200,83,.45)}50%{box-shadow:0 0 36px rgba(0,230,118,.95),0 6px 26px rgba(0,200,83,.75)}}
    </style>
    <div style="
      display:flex;align-items:center;justify-content:space-between;
      gap:12px;padding:10px 14px 10px;
      background:linear-gradient(135deg,rgba(0,20,8,.95),rgba(0,40,15,.95));
      border-bottom:1px solid rgba(0,230,118,.18);
    ">
      <div style="flex:1;min-width:0;">
        <div style="color:#fff;font-size:13.5px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          Ela está te esperando pelada…
        </div>
        <div style="color:rgba(0,230,118,.85);font-size:11.5px;margin-top:2px;font-weight:500;">
          🔴 Ao vivo agora
        </div>
      </div>
      <button onclick="reopenPaywall()" style="
        flex-shrink:0;
        background:linear-gradient(135deg,#00e676 0%,#00c853 55%,#009624 100%);
        color:#fff;font-size:13px;font-weight:800;letter-spacing:.2px;
        padding:10px 16px;border-radius:12px;border:none;
        cursor:pointer;white-space:nowrap;
        box-shadow:0 0 16px rgba(0,230,118,.55);
        animation:glowG 1.8s ease-in-out infinite;
        -webkit-tap-highlight-color:transparent;
      ">🔥 Desbloquear</button>
    </div>
    <div style="width:100%;text-align:center;color:rgba(255,255,255,.3);font-size:12.5px;padding:8px 20px;font-style:italic;">
      Chat Encerrado
    </div>
  `;
  full.appendChild(composer);
}

// estado global do countdown — permite pausar/retomar
const _cd = { interval: null, remaining: 0, resolve: null };

function _cdGetMsg(n) {
  if (n >= 10) return "PREPARANDO SESSÃO AO VIVO...";
  if (n >= 5)  return "ESTABELECENDO CONEXÃO... 🔥";
  return "CONECTANDO AGORA...";
}

function pauseCountdown() {
  if (!_cd.resolve) return;
  if (_cd.interval) { clearInterval(_cd.interval); _cd.interval = null; }
  const vid = document.getElementById("chatBgVideo");
  if (vid && !vid.paused) vid.pause();
}

function resumeCountdown() {
  if (!_cd.resolve || _cd.remaining <= 0) return;
  const shell = document.querySelector(".chatShell");
  if (!shell) return;
  // esconde barra de input (pode ter sido recriada pelo mountChat)
  const composer = document.querySelector(".composer");
  if (composer) composer.style.display = "none";
  const inp = document.getElementById("input");
  if (inp) { inp.readOnly = true; inp.tabIndex = -1; }
  // recria badge se sumiu (ex: mountChat recriou o DOM)
  if (!document.getElementById("countdownBadge")) {
    _mountCdBadge(shell, _cd.remaining);
  } else {
    const t = document.getElementById("cdTimer");
    const m = document.getElementById("cdMsg");
    if (t) t.textContent = _cd.remaining;
    if (m) m.textContent = _cdGetMsg(_cd.remaining);
  }
  const vid = document.getElementById("chatBgVideo");
  if (vid) { vid.style.opacity = "0.55"; vid.play().catch(() => {}); }
  _cd.interval = setInterval(_cdTick, 1000);
}

function _cdTick() {
  _cd.remaining--;
  const t = document.getElementById("cdTimer");
  const m = document.getElementById("cdMsg");
  if (t) {
    t.style.animation = "none";
    requestAnimationFrame(() => { t.style.animation = "cdPop .25s ease-out"; });
    t.textContent = _cd.remaining;
  }
  if (m) m.textContent = _cdGetMsg(_cd.remaining);
  if (_cd.remaining <= 0) {
    clearInterval(_cd.interval); _cd.interval = null;
    document.getElementById("countdownBadge")?.remove();
    const composer = document.querySelector(".composer");
    if (composer) composer.style.display = "";
    trackEvent("MINIAPP_COUNTDOWN_DONE");
    const res = _cd.resolve; _cd.resolve = null;
    if (res) res();
  }
}

function _mountCdBadge(shell, initial) {
  const cdEl = document.createElement("div");
  cdEl.id = "countdownBadge";
  cdEl.style.cssText = `
    position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
    z-index:10;display:flex;flex-direction:column;align-items:center;gap:12px;
    pointer-events:none;
  `;
  cdEl.innerHTML = `
    <style>
      @keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(1.5)}}
      @keyframes cdPop{0%{transform:scale(1.35);opacity:0}100%{transform:scale(1);opacity:1}}
      @keyframes badgeGlow{0%,100%{box-shadow:0 0 12px rgba(255,59,48,.7),0 0 28px rgba(255,59,48,.35)}50%{box-shadow:0 0 22px rgba(255,59,48,1),0 0 52px rgba(255,59,48,.6)}}
      @keyframes timerGlow{0%,100%{text-shadow:0 0 18px rgba(255,80,60,.5),0 2px 24px rgba(0,0,0,.95)}50%{text-shadow:0 0 38px rgba(255,80,60,.9),0 2px 24px rgba(0,0,0,.95)}}
    </style>
    <div style="display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,rgba(200,20,10,.92),rgba(230,50,20,.88));border-radius:999px;padding:9px 18px;animation:badgeGlow 1.2s ease-in-out infinite;box-shadow:0 0 18px rgba(255,59,48,.7),0 0 36px rgba(255,59,48,.35);">
      <span style="width:11px;height:11px;border-radius:50%;background:#fff;display:inline-block;animation:livePulse 0.9s ease-in-out infinite;flex-shrink:0;box-shadow:0 0 8px rgba(255,255,255,.9);"></span>
      <span style="color:#fff;font-size:15px;font-weight:900;letter-spacing:2px;text-transform:uppercase;text-shadow:0 1px 8px rgba(0,0,0,.5);">🔴 AO VIVO EM</span>
    </div>
    <div id="cdTimer" style="color:#fff;font-size:96px;font-weight:900;letter-spacing:-4px;line-height:1;font-variant-numeric:tabular-nums;animation:cdPop .25s ease-out, timerGlow 1.4s ease-in-out infinite;">${initial}</div>
    <div id="cdMsg" style="color:rgba(255,255,255,.9);font-size:13px;font-weight:700;letter-spacing:.08em;text-shadow:0 1px 10px rgba(0,0,0,.95);text-align:center;padding:0 28px;min-height:20px;">${_cdGetMsg(initial)}</div>
  `;
  shell.appendChild(cdEl);
}

function showCountdown(seconds) {
  return new Promise(resolve => {
    FocusGateway.requestDismiss();
    const inp = document.getElementById("input");
    if (inp) { inp.readOnly = true; inp.tabIndex = -1; }
    const composer = document.querySelector(".composer");
    if (composer) composer.style.display = "none";

    const shell = document.querySelector(".chatShell");
    if (!shell) { resolve(); return; }

    // inicia vídeo com fade in desde o segundo 0
    const vid = document.getElementById("chatBgVideo");
    if (vid) {
      vid.pause();
      vid.currentTime = 0;
      const doPlay = () => {
        vid.play().catch(() => {});
        vid.style.transition = "opacity 0.6s ease";
        vid.style.opacity = "0.55";
      };
      vid.addEventListener("seeked", doPlay, { once: true });
      setTimeout(doPlay, 80);
      document.addEventListener("touchstart", () => vid.play().catch(() => {}), { once: true, passive: true });
    }

    _mountCdBadge(shell, seconds);
    _cd.remaining = seconds;
    _cd.resolve   = resolve;
    _cd.interval  = setInterval(_cdTick, 1000);
  });
}

function showLiveCallCta() {
  return new Promise(resolve => {
    // pausa no frame atual (segundo 15 do vídeo) e aumenta opacidade suavemente
    const bgVid = document.getElementById("chatBgVideo");
    if (bgVid) {
      bgVid.pause();
      requestAnimationFrame(() => {
        bgVid.style.transition = "opacity 0.7s ease";
        bgVid.style.opacity = "0.72";
      });
    }

    const shell = document.querySelector(".chatShell");
    if (!shell) { resolve(); return; }

    const el = document.createElement("div");
    el.id = "liveCallCta";
    el.style.cssText = `
      position:absolute;inset:0;z-index:20;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:24px 20px;pointer-events:none;
    `;
    el.innerHTML = `
      <style>
        @keyframes ctaPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,59,48,.6),0 6px 28px rgba(255,59,48,.28)}70%{box-shadow:0 0 0 20px rgba(255,59,48,0),0 6px 28px rgba(255,59,48,.28)}}
        @keyframes ctaFadeIn{from{opacity:0;transform:translateY(30px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes ctaFadeOut{to{opacity:0;transform:translateY(10px) scale(.96)}}
        @keyframes onlineDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.35)}}
      </style>
      <div id="liveCallCard" style="
        animation:ctaFadeIn .45s cubic-bezier(.25,.46,.45,.94) both;
        display:flex;flex-direction:column;align-items:center;gap:18px;
        background:rgba(8,8,8,.86);border:1px solid rgba(255,255,255,.1);
        border-radius:26px;padding:28px 22px;
        backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
        max-width:340px;width:100%;
        box-shadow:0 28px 72px rgba(0,0,0,.65);
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="width:9px;height:9px;border-radius:50%;background:#25d366;flex-shrink:0;display:inline-block;animation:onlineDot 1.4s ease-in-out infinite;"></span>
          <span style="color:#25d366;font-size:13px;font-weight:700;letter-spacing:.02em;">Gabriely Castro está online agora</span>
        </div>
        <p style="color:rgba(255,255,255,.88);font-size:15px;font-weight:600;text-align:center;line-height:1.5;margin:0;">
          Clique no botão abaixo pra receber uma chamada de vídeo de Gabriely Castro 🔥🥵
        </p>
        <button id="btnLiveCall" style="
          width:100%;padding:17px 14px;border-radius:16px;border:0;cursor:pointer;
          background:linear-gradient(135deg,#ff3b30,#ff6835);
          color:#fff;font-size:13.5px;font-weight:900;letter-spacing:.03em;
          text-transform:uppercase;line-height:1.35;
          animation:ctaPulse 1.7s ease-in-out infinite;
          pointer-events:auto;-webkit-tap-highlight-color:transparent;
        ">📲 PEDIR PRA ALANA ENTRAR AO VIVO COMIGO AGORA!</button>
      </div>
    `;
    shell.appendChild(el);

    document.getElementById("btnLiveCall").onclick = () => {
      trackEvent("MINIAPP_CTA_CLICK");
      // vídeo some com fade e fundo normal do chat volta
      if (bgVid) {
        bgVid.style.transition = "opacity 0.45s ease";
        bgVid.style.opacity = "0";
        setTimeout(() => {
          // restaura backgrounds do CSS
          document.body.style.background = "";
          const appEl = document.getElementById("app");
          if (appEl) appEl.style.background = "";
          const full = document.querySelector(".full");
          if (full) full.style.background = "";
          const s = document.querySelector(".chatShell");
          if (s) { s.style.background = ""; s.classList.remove("vid-active"); }
          const c = document.getElementById("chat");
          if (c) c.style.background = "";
          bgVid.style.display = "none";
          bgVid.dataset.done = "1";
        }, 450);
      }
      // card sai com fade
      const card = document.getElementById("liveCallCard");
      if (card) card.style.animation = "ctaFadeOut 0.28s ease forwards";
      setTimeout(() => { el.remove(); resolve(); }, 260);
    };
  });
}

async function startScript() {
  if (state.flags.startedChat) return;
  state.flags.startedChat = true;
  state.step = 1; saveState();
  trackEvent("MINIAPP_CHAT_STARTED");
  _flowRunning = true;
  try {
    // Fica com "visto por último" por 4-5s (já aparece assim desde mountChat), depois online
    await sleep(rand(4000, 5000));
    setStatus("online");
    state.flags.botOnline = true; saveState();
    await sleep(rand(1500, 2500));
    await gisaSendPhoto(ASSETS.teasePhotoPrivada, "Foto Privada");
    await sleep(rand(300, 600));
    await gisaSendAudio(ASSETS.audioCallInvite, null, 7500);
    await sleep(rand(300, 600));
    await gisaSay("me fala a verdade…\nvocê aguenta me ver pelada de verdade\nou vai só ficar olhando igual os fracos?... 👀", { delay: 2000 });
  } finally {
    _flowRunning = false;
  }
  state._t1 = setTimeout(async () => {
    if (state.step !== 1) return;
    await gisaSay("tá aí ou já correu covarde? 👀");
    state._t2 = setTimeout(async () => {
      if (state.step !== 1) return;
      await gisaSay("typical… entra, olha e some. Mas eu não sou pra qualquer um não, safado.");
    }, 2 * 60 * 1000);
  }, 2 * 60 * 1000);
}

async function handleUserText(text) {
  if (state.step >= 6) return; // chat locked after paywall
  if (_flowRunning) return; // flow already running — ignore extra messages
  clearReengage();
  _flowRunning = true;
  // Pausa de "percebeu a mensagem" antes de qualquer "digitando..." aparecer
  // — sem isso, a resposta reagia no exato instante do envio, o que não
  // parece humano. Cada fluxo específico pode (e alguns já fazem) somar
  // mais tempo depois disso; esse piso garante que NUNCA fica instantâneo.
  await sleep(rand(700, 1600));
  try {
    // step 1 → abertura: 1ª resposta do lead classifica a categoria (ver
    // classifyLeadReply/enterOpeningReply) e trava em state.leadCategory.
    if (state.step === 1) { await enterOpeningReply(text); return; }
    // step 2 → qualquer resposta avança pra rodada de provocação (seção 3),
    // a categoria já foi travada na seção 2, não é reclassificada aqui.
    if (state.step === 2) { await enterProvocationRound(); return; }
  } catch(e) { if (!(e instanceof FlowCancelledError)) throw e; }
  finally { _flowRunning = false; }
}

function trackEvent(event) {
  const chatId = tg?.initDataUnsafe?.user?.id;
  if (!chatId) return;
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: String(chatId), event }),
    keepalive: true,
  }).catch(() => {});
}

function openCheckout() {
  try { localStorage.setItem("gisa_checkout_done", "1"); } catch {}
  trackEvent("MINIAPP_CHECKOUT_CLICK");
  const chatId = tg?.initDataUnsafe?.user?.id;
  if (chatId) {
    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: String(chatId) }),
      keepalive: true,
    }).catch(() => {});
    try { if (tg?.close) tg.close(); } catch {}
  } else {
    window.open(CHECKOUT_URL, "_blank");
  }
}

let _paywallOverlay = null;

function _dismissPaywall(overlay) {
  const sheet = overlay.querySelector("#pwSheet");
  if (sheet) {
    sheet.style.transition = "transform 0.32s cubic-bezier(0.4,0,1,1)";
    sheet.style.transform  = "translateY(100%)";
  }
  overlay.style.background = "rgba(0,0,0,0)";
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 340);
}

function reopenPaywall() {
  trackEvent("MINIAPP_PAYWALL_REOPEN");
  if (!_paywallOverlay) return;
  const overlay = _paywallOverlay;
  const sheet   = overlay.querySelector("#pwSheet");
  if (sheet) {
    sheet.style.transition = "";
    sheet.style.transform  = "translateY(100%)";
  }
  overlay.style.background = "rgba(0,0,0,0)";
  document.body.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.style.background = "rgba(0,0,0,0.72)";
    if (sheet) {
      sheet.style.transition = "transform 0.42s cubic-bezier(0.34,1.56,0.64,1)";
      sheet.style.transform  = "translateY(0)";
    }
    document.getElementById("paywallHeroVideo")?.play().catch(() => {});
  }));
}

function showCheckoutCta(opts = {}) {
  trackEvent("MINIAPP_PAYWALL_SHOWN");
  try { localStorage.setItem("gisa_paywall_reached", "1"); } catch {}
  lockChat();

  const overlay = document.createElement("div");
  overlay.id = "paywallOverlay";
  _paywallOverlay = overlay;
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9800;
    background:rgba(0,0,0,0);
    transition:background 0.28s ease;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes glowG{0%,100%{box-shadow:0 0 22px rgba(0,230,118,.65),0 4px 18px rgba(0,200,83,.5)}50%{box-shadow:0 0 44px rgba(0,230,118,1),0 8px 32px rgba(0,200,83,.8)}}
      @keyframes ctaPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}
      @keyframes liveGlow{0%,100%{box-shadow:0 0 8px rgba(255,59,48,.5);opacity:1}50%{box-shadow:0 0 18px rgba(255,59,48,.9),0 0 28px rgba(255,59,48,.4);opacity:.85}}
      @keyframes pwSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      @keyframes pwImgIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
      @keyframes pwFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pwBtnPop{0%{opacity:0;transform:scale(0.88)}70%{transform:scale(1.04)}100%{opacity:1;transform:scale(1)}}
    </style>

    <div id="pwSheet" style="
      position:absolute;bottom:0;left:0;right:0;
      background:#0a0a0a;
      border-radius:22px 22px 0 0;
      overflow:hidden;
      max-height:92vh;overflow-y:auto;
      box-shadow:0 -8px 40px rgba(0,0,0,0.55);
      animation:pwSlideUp 0.42s cubic-bezier(0.34,1.56,0.64,1) forwards;
    ">

      <video id="paywallHeroVideo" src="/assets/%23viral%20(4).mp4" autoplay loop muted playsinline
        style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%;z-index:0;opacity:0;animation:pwImgIn 0.34s ease 0.08s forwards;"></video>

      <!-- degradê cobrindo o vídeo inteiro (topo ao fundo), não só a parte de
           baixo — sem isso o topo aparecia sem nenhum escurecimento (100%
           opacidade) enquanto o resto tinha o degradê .40→.88 -->
      <div style="position:absolute;inset:0;z-index:1;background:linear-gradient(to bottom,rgba(10,10,10,.15),rgba(10,10,10,.55));pointer-events:none;"></div>

      <div style="width:100%;height:52vw;max-height:290px;min-height:190px;flex-shrink:0;position:relative;z-index:1;"></div>

      <div style="flex:1;position:relative;overflow:hidden;z-index:1;">
        <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;
                    padding:26px 24px calc(env(safe-area-inset-bottom,20px) + 24px);">

          <div style="background:rgba(255,59,48,.14);border:1px solid rgba(255,59,48,.32);
                      border-radius:20px;padding:5px 16px;margin-bottom:22px;
                      opacity:0;animation:liveGlow 1.4s ease-in-out 0.56s infinite, pwFadeUp 0.26s ease 0.22s forwards;">
            <span style="color:#ff6b6b;font-size:12.5px;font-weight:700;letter-spacing:.5px;">🔴 AO VIVO AGORA</span>
          </div>

          <div style="color:#fff;font-size:22px;font-weight:800;text-align:center;line-height:1.3;letter-spacing:-.3px;margin-bottom:10px;
                      opacity:0;animation:pwFadeUp 0.26s ease 0.30s forwards;">
            Desbloqueia e volta<br/>imediatamente pra chamada
          </div>

          <div style="color:rgba(255,255,255,.58);font-size:15px;text-align:center;line-height:1.55;margin-bottom:32px;
                      opacity:0;animation:pwFadeUp 0.26s ease 0.38s forwards;">
            Eu tô te esperando pelada e safada.
          </div>

          <button id="goCheckoutBtn" style="
            width:100%;padding:18px 20px;border-radius:18px;border:none;
            background:linear-gradient(135deg,#00e676 0%,#00c853 55%,#009624 100%);
            color:#fff;font-size:17px;font-weight:900;letter-spacing:.3px;
            cursor:pointer;-webkit-tap-highlight-color:transparent;
            box-shadow:0 0 28px rgba(0,230,118,.7),0 6px 22px rgba(0,200,83,.55);
            animation:glowG 1.8s ease-in-out 0.86s infinite, ctaPulse 2.6s ease-in-out 0.86s infinite, pwBtnPop 0.38s cubic-bezier(0.34,1.56,0.64,1) 0.46s both;
            margin-bottom:22px;
          ">🔥 DESBLOQUEAR ACESSO COMPLETO AGORA</button>

          <button id="paywallDismiss" style="
            background:none;border:none;color:rgba(255,255,255,.28);
            font-size:13px;cursor:pointer;padding:8px;
            opacity:0;animation:pwFadeUp 0.22s ease 0.58s forwards;
            -webkit-tap-highlight-color:transparent;
          ">Ver conversa</button>

        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.style.background = "rgba(0,0,0,0.72)";
    document.getElementById("paywallHeroVideo")?.play().catch(() => {});
  }));

  setTimeout(() => {
    const btn = document.getElementById("goCheckoutBtn");
    // "DESBLOQUEAR ACESSO" não redireciona mais direto pro checkout — abre a
    // roleta de desconto primeiro; o clique final dela (dentro de
    // runDiscountRouletteScreen) é quem chama openCheckout() de verdade.
    // Exceção: quem já passou pela roleta antes (reabrindo o mini app,
    // opts.skipRoulette) vai direto pro checkout — não faz sentido girar
    // de novo pra quem já pegou o desconto.
    if (btn) {
      btn.onclick = opts.skipRoulette
        ? () => { _dismissPaywall(overlay); openCheckout(); }
        : () => { _dismissPaywall(overlay); runDiscountRouletteScreen(); };
    }
    const dismiss = document.getElementById("paywallDismiss");
    if (dismiss) dismiss.onclick = () => { trackEvent("MINIAPP_PAYWALL_DISMISS"); _dismissPaywall(overlay); };
  }, 0);

  setTimeout(async () => {
    if (state.step < 6) return;
    await gisaSay("ainda tô aqui… molhada… esperando você decidir");
  }, 45000);
  setTimeout(async () => {
    if (state.step < 6) return;
    await gisaSay("os que têm coragem já estão vendo tudo\nvocê vai ficar só imaginando?");
  }, 3 * 60 * 1000);
  setTimeout(async () => {
    if (state.step < 6) return;
    await gisaSay("última chance real de me ver gozando só pra você hoje");
  }, 12 * 60 * 1000);
}

// ==================== STORY VIDEO INIT ====================
(function initStoryVideo() {
  if (document.getElementById("storyVideo")) return;
  const video = document.createElement("video");
  video.id = "storyVideo";
  video.src = "/assets/IMG_7071.MP4";
  video.preload = "auto";
  video.muted = false;
  video.playsInline = true;
  Object.assign(video.style, {
    position:"fixed", top:"0", left:"0", width:"100vw", height:"100dvh",
    objectFit:"cover", zIndex:"0", display:"none",
  });
  document.body.appendChild(video);
  video.load();
})();

// ==================== STORIES ====================
const STORY_EASING   = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";
const STORY_DURATION = 320;
let _storyExiting = false;

function getAvatarOrigin() {
  const el = document.querySelector("[data-story-avatar]");
  if (!el) return { x:"50%", y:"50%" };
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width/2) + "px", y: Math.round(r.top + r.height/2) + "px" };
}

function markStoryAsViewed() {
  document.querySelectorAll("[data-story-avatar]").forEach(el => {
    el.classList.add("story-viewed");
    el.style.borderColor = "rgba(255,255,255,.2)";
  });
  window.storyViewed = true;
}

function exitStories(fromSwipe = false, swipeScreen = null) {
  if (_storyExiting) return;
  _storyExiting = true;
 
  const video  = document.getElementById("storyVideo");
  const screen = swipeScreen || document.querySelector(".full");
 
  if (!screen) { _storyExiting = false; return; }
 
  // marca como visto apenas na primeira vez
  if (!window.storyEverViewed) {
    window.storyEverViewed = true;
    markStoryAsViewed();
  }
 
  const origin = getAvatarOrigin();
  screen.style.transformOrigin = `${origin.x} ${origin.y}`;
  screen.style.transition = `transform ${STORY_DURATION}ms ${STORY_EASING}, opacity ${STORY_DURATION}ms ${STORY_EASING}`;
  screen.style.transform  = fromSwipe ? "scale(0) translateY(0)" : "scale(0.04)";
  screen.style.opacity    = "0";
 
  setTimeout(() => {
    // ✅ NUNCA limpa video.src — só pausa e esconde
    video.pause();
    video.style.display = "none";
    video.oncanplay = null;
    video.onplay    = null;
    video.onpause   = null;
    video.onended   = null;
 
    _storyExiting = false;
    app.style.zIndex = "";
    mountChat();
    resumeCountdown();
  }, STORY_DURATION + 30);
}

// =============================================================================
// SUBSTITUA AS FUNÇÕES ABAIXO NO SEU app.js
// =============================================================================


// ─── showStories ─────────────────────────────────────────────────────────────
function showStories() {
  pauseCountdown();
  FocusGateway.requestDismiss();

  _storyExiting      = false;
  window.storyViewed = false;

  const video = document.getElementById("storyVideo");

  video.muted = false;

  Object.assign(video.style, {
    display:       "block",
    position:      "fixed",
    top:           "0",
    left:          "0",
    width:         "100vw",
    height:        "100dvh",
    objectFit:     "cover",
    zIndex:        "10",
    transform:     "translateZ(0)",
    willChange:    "transform",
    pointerEvents: "none",
  });
  // #app has position:fixed with no explicit z-index (auto ≈ 0), so the video
  // at z-index:10 would cover the story UI inside #app. Lift #app above the video.
  app.style.zIndex = "20";

  // 1) play() síncrono no gesto do usuário — desbloqueia o áudio no iOS WKWebView
  //    (pode falhar se o vídeo já terminou, mas o desbloqueio já acontece)
  video.play().catch(() => {});

  // 2) Recarrega o vídeo do início; oncanplay dispara quando pronto e toca com áudio
  //    já desbloqueado pelo play() acima
  video.oncanplay = null;
  video.src = "/assets/IMG_7071.MP4";
  video.load();
  video.oncanplay = () => {
    video.oncanplay = null;
    video.play().catch(() => {});
  };

  const origin = getAvatarOrigin();

  app.innerHTML = `
    <div class="full" style="
      background:transparent;position:relative;overflow:hidden;
      height:100dvh;z-index:15;
      transform-origin:${origin.x} ${origin.y};
      transform:scale(0.04);opacity:0;
      will-change:transform,opacity;
    ">

      <!-- progresso -->
      <div style="position:absolute;top:0;left:0;right:0;height:3px;
                  background:rgba(255,255,255,0.22);z-index:20;">
        <div id="progressBar" style="height:100%;width:0%;background:#fff;
                                      transition:width .1s linear;"></div>
      </div>

      <!-- header -->
      <div style="position:absolute;top:8px;left:14px;right:14px;
                  display:flex;align-items:center;z-index:30;">
        <button style="
          background:none;border:0;color:#fff;font-size:34px;
          margin-right:10px;padding:0;line-height:1;cursor:default;pointer-events:none;">‹</button>
        <div style="width:32px;height:32px;margin-right:10px;border-radius:50%;
                    overflow:hidden;flex-shrink:0;">
          <img src="${ASSETS.avatar}?v=1"
               style="width:100%;height:100%;object-fit:cover;object-position:top;"/>
        </div>
        <div style="margin-top:1px;">
          <div style="color:#fff;font-weight:600;font-size:15px;">${CONTACT.title}</div>
          <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:2px;">12h</div>
        </div>
      </div>

      <!-- barra de resposta -->
      <div id="replyBar" style="
        position:absolute;bottom:0;left:0;right:0;
        padding:12px 16px 28px;
        background:linear-gradient(to top,rgba(0,0,0,.88),transparent);
        z-index:40;
      ">
        <div style="display:flex;align-items:center;gap:10px;">

          <!-- campo de texto -->
          <div onclick="openStoryReply()" style="
            flex:1;
            background:rgba(255,255,255,.13);
            border:1px solid rgba(255,255,255,.25);
            border-radius:28px;
            padding:11px 18px;
            color:rgba(255,255,255,0.7);
            font-size:15px;
            cursor:text;
          ">Responder...</div>

        </div>
      </div>

    </div>
  `;

  const screen = document.querySelector(".full");

  // animação de entrada
  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.style.transition = `transform ${STORY_DURATION}ms ${STORY_EASING}, opacity ${STORY_DURATION}ms ${STORY_EASING}`;
    screen.style.transform  = "scale(1)";
    screen.style.opacity    = "1";
  }));

  // progress bar
  const progress = document.getElementById("progressBar");
  let progressInterval = null;

  video.onplay = () => {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!video.duration) return;
      progress.style.width = (video.currentTime / video.duration) * 100 + "%";
    }, 50);
  };
  video.onpause = () => clearInterval(progressInterval);
  video.onended = () => {
    clearInterval(progressInterval);
    window.storyViewed = true;
    exitStories();
  };

  // click para sair
  screen.addEventListener("click", (e) => {
    if (e.target.closest("#replyBar") || e.target.closest("button") || _storyExiting) return;
    window.storyViewed = true;
    exitStories();
  });

  // swipe down + hold
  let startY = 0, startX = 0, currentY = 0;
  let dragging = false, isHolding = false, holdTimer = null, swipeCommitted = false;

  screen.addEventListener("touchstart", (e) => {
    if (_storyExiting) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    currentY = startY; dragging = true; swipeCommitted = false; isHolding = false;
    holdTimer = setTimeout(() => {
      if (!swipeCommitted) { isHolding = true; video.pause(); }
    }, 180);
  }, { passive: true });

  screen.addEventListener("touchmove", (e) => {
    if (_storyExiting || !dragging || isHolding) return;
    clearTimeout(holdTimer);
    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    const diffY  = touchY - startY;
    const diffX  = Math.abs(touchX - startX);
    if (diffX > diffY || diffY <= 0) return;
    currentY = touchY;
    const prog2 = Math.min(diffY / (window.innerHeight * 0.55), 1);
    screen.style.transition      = "none";
    screen.style.transformOrigin = `${origin.x} ${origin.y}`;
    screen.style.transform       = `translateY(${diffY * 0.65}px) scale(${1 - prog2 * 0.46})`;
    screen.style.opacity         = String(Math.max(1 - prog2 * 0.65, 0.35));
  }, { passive: true });

  screen.addEventListener("touchend", () => {
    clearTimeout(holdTimer);
    if (isHolding) {
      isHolding = false; dragging = false;
      video.play().catch(() => {});
      return;
    }
    dragging = false;
    if (_storyExiting) return;
    const diffY = currentY - startY;
    if (diffY < 100) {
      screen.style.transition      = `transform 0.28s ${STORY_EASING}, opacity 0.28s ${STORY_EASING}`;
      screen.style.transformOrigin = `${origin.x} ${origin.y}`;
      screen.style.transform       = "translateY(0) scale(1)";
      screen.style.opacity         = "1";
      return;
    }
    swipeCommitted = true;
    window.storyViewed = true;
    exitStories(true, screen);
  });
}

// =============================================================================
// SUBSTITUA ESTAS 3 FUNÇÕES NO SEU app.js
// =============================================================================


// ─── openStoryReply ───────────────────────────────────────────────────────────
function openStoryReply() {
  if (document.getElementById("storyReplyOverlay")) return;

  const video  = document.getElementById("storyVideo");
  const oldBar = document.getElementById("replyBar");
  if (video) video.pause();
  if (oldBar) oldBar.style.display = "none";
  document.body.style.overflow = "hidden";

  // injeta CSS uma única vez
  if (!document.getElementById("storyReplyCSS")) {
    const style = document.createElement("style");
    style.id = "storyReplyCSS";
    style.textContent = `
      #storyBottomBlock {
        position: fixed;
        left: 0; right: 0;
        top: 0; bottom: 0;
        z-index: 10001;
        display: flex;
        flex-direction: column;
        pointer-events: none;
      }
      #storyEmojiBlock {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        padding: 0 20px;
        pointer-events: none;
      }
      #storyEmojiBlock span {
        pointer-events: auto;
      }
      #replyBarKeyboard {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px 10px;
        background: #000;
        pointer-events: auto;
        width: 100%;
      }
    `;
    document.head.appendChild(style);
  }

  // ghost input — abre teclado imediatamente
  const ghost = document.createElement("input");
  ghost.type = "text";
  ghost.setAttribute("autocomplete", "off");
  ghost.style.cssText = "position:fixed;left:0;bottom:0;width:100%;height:44px;opacity:0;font-size:16px;pointer-events:none;z-index:-1;border:none;outline:none;background:transparent;";
  document.body.appendChild(ghost);
  ghost.focus();

  document.body.insertAdjacentHTML("beforeend", `
    <div id="storyReplyOverlay" style="
      position:fixed;inset:0;z-index:9999;
    ">

      <!-- dismiss -->
      <div id="storyReplyDismiss" style="
        position:absolute;inset:0;z-index:1;
      "></div>

      <!-- emojis + input (sobem juntos com o teclado) -->
      <div id="storyBottomBlock">
      <div id="storyEmojiBlock">
        <div style="display:flex;gap:26px;align-items:center;justify-content:center;width:100%;">
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">😍</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">😂</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">😮</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">😢</span>
        </div>
        <div style="display:flex;gap:26px;align-items:center;justify-content:center;width:100%;">
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">🙏</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">👏</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">🎉</span>
          <span onclick="sendStoryReaction(this)" style="font-size:40px;cursor:pointer;line-height:1;user-select:none;-webkit-tap-highlight-color:transparent;">💯</span>
        </div>
      </div>

      <!-- input bar -->
      <div id="replyBarKeyboard">
        <div style="
          flex:1;background:#1c1c1e;border-radius:22px;
          padding:9px 16px;display:flex;align-items:center;
        ">
          <input id="storyReplyInput" type="text"
            placeholder="Enviar mensagem..."
            autocomplete="off" autocorrect="off"
            autocapitalize="off" spellcheck="false"
            style="
              background:transparent;border:none;outline:none;
              color:#fff;font-size:16px;width:100%;
              font-family:-apple-system,BlinkMacSystemFont,sans-serif;
            "
          />
        </div>
        <div id="storyReplySend" style="
          width:38px;height:38px;border-radius:50%;
          background:#25D366;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;pointer-events:auto;
        ">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#fff" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </div>
      </div>
      </div>

    </div>
  `);

  const overlay = document.getElementById("storyReplyOverlay");
  const input   = document.getElementById("storyReplyInput");
  const dismiss = document.getElementById("storyReplyDismiss");
  const sendBtn = document.getElementById("storyReplySend");

  // transfere foco
  ghost.addEventListener("blur", () => ghost.remove());
  input.focus();

  // Enter envia
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendStoryTextReply(); }
  });
  sendBtn.onclick = sendStoryTextReply;
  dismiss.addEventListener("click", closeStoryReply);
}


// ─── sendStoryTextReply ───────────────────────────────────────────────────────
function sendStoryTextReply() {
  const input = document.getElementById("storyReplyInput");
  const text  = input?.value?.trim() ?? "";
  closeStoryReply();
  if (!text) return;

  const t = document.createElement("div");
  t.textContent = "Mensagem enviada ✓";
  Object.assign(t.style, {
    position:"fixed", left:"50%", bottom:"90px",
    transform:"translateX(-50%)",
    background:"rgba(18,18,18,.92)", color:"#fff",
    padding:"10px 20px", borderRadius:"999px",
    fontSize:"14px", fontWeight:"500",
    zIndex:"999999", opacity:"0",
    transition:"opacity .25s ease",
    whiteSpace:"nowrap",
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; });
  setTimeout(() => { t.style.opacity = "0"; }, 1800);
  setTimeout(() => t.remove(), 2200);
}


// ─── closeStoryReply ─────────────────────────────────────────────────────────
function closeStoryReply() {
  const overlay = document.getElementById("storyReplyOverlay");
  if (!overlay) return;

  document.querySelectorAll("input[style*='pointer-events:none'][style*='opacity:0']")
    .forEach(e => e.remove());

  overlay.remove();
  document.body.style.overflow = "";
  window.scrollTo(0, 0);
  setTimeout(() => window.scrollTo(0, 0), 30);

  const oldBar = document.getElementById("replyBar");
  if (oldBar) {
    oldBar.style.display   = "";
    oldBar.style.opacity   = "1";
    oldBar.style.transform = "translateY(0)";
  }

  const video = document.getElementById("storyVideo");
  if (video) {
    Object.assign(video.style, {
      position:"fixed", top:"0", left:"0",
      width:"100vw",
      height:"100dvh",
      objectFit:"cover",
      transform:"translateZ(0)",
      willChange:"transform",
    });
    video.play().catch(() => {});
  }
}

function sendStoryReaction(emojiEl) {
  if (!emojiEl) return;
  const avatar = document.querySelector(".full img");
  if (!avatar) return;
  const emoji = emojiEl.textContent.trim();
  try { if (navigator.vibrate) navigator.vibrate([40,30,60]); } catch {}
  const from = emojiEl.getBoundingClientRect(), to = avatar.getBoundingClientRect();
  const fly = document.createElement("div");
  fly.textContent = emoji;
  Object.assign(fly.style, { position:"fixed", left:from.left+from.width/2+"px", top:from.top+from.height/2+"px", fontSize:"34px", zIndex:"999999", pointerEvents:"none", transition:"transform .65s cubic-bezier(.22,.8,.22,1), opacity .65s ease" });
  document.body.appendChild(fly);
  const dx = to.left+to.width/2-(from.left+from.width/2);
  const dy = to.top+to.height/2-(from.top+from.height/2);
  closeStoryReply();
  requestAnimationFrame(() => { fly.style.transform = `translate(${dx}px,${dy}px) scale(.18)`; fly.style.opacity = "0"; });
  const toast = document.createElement("div");
  toast.textContent = "Enviando resposta...";
  Object.assign(toast.style, { position:"fixed", left:"50%", bottom:"120px", transform:"translateX(-50%)", background:"rgba(18,18,18,.92)", color:"#fff", padding:"12px 18px", borderRadius:"999px", fontSize:"15px", fontWeight:"500", zIndex:"999999", opacity:"0", transition:"opacity 1.5s ease" });
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; });
  setTimeout(() => { toast.style.opacity = "0"; }, 1600);
  setTimeout(() => { toast.remove(); fly.remove(); }, 3200);
}

// ==================== PROFILE ====================
function openProfile() {
  pauseCountdown();
  const contact = CONTACT;
  app.innerHTML = `
    <div class="slideInRight" style="background:#0a0a0a;color:#fff;height:100vh;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;background:#111111;z-index:10;">
        <span onclick="mountChat();resumeCountdown();" style="position:absolute;left:14px;font-size:28px;cursor:pointer;">‹</span>
        Dados do contato
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;margin-top:24px;">
        <div data-story-avatar id="profileMainAvatar" style="
          width:110px;height:110px;border-radius:50%;
          border:4px solid ${window.storyViewed ? "rgba(255,255,255,0.25)" : "#25D366"};
          padding:3px;box-sizing:border-box;cursor:pointer;
          transition:border-color 0.4s ease;
        ">
          <img src="${ASSETS.avatar}?v=1" style="width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:top;" loading="eager" decoding="sync">
        </div>
        <div style="margin-top:14px;font-size:26px;font-weight:700;color:#fff;letter-spacing:-.3px;">${contact.name||contact.title}</div>
        <div style="margin-top:4px;font-size:15px;color:rgba(255,255,255,0.55);">@${contact.username||contact.title}</div>
        <div style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.55);text-align:center;max-width:280px;">${contact.bio||""}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);padding:22px 14px 12px;gap:12px;">
        ${actionBtnSVG(iconCall(),   "Ligar",      "startCall")}
        ${actionBtnSVG(iconVideo2(), "Vídeo",      "startVideoCall")}
        ${actionBtnSVG(iconPix(),    "Pix",        "showPixAlert")}
        ${actionBtnSVG(iconSearch(), "Pesquisar",  "")}
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        <div onclick="openMediaScreen()" style="cursor:pointer;">${item(iconMedia(),"Mídia, links e docs")}</div>
        <div onclick="openStorageScreen()">${item(iconStorage(),"Gerenciar armazenamento")}</div>
        <div onclick="openSavedMessages()">${item(iconSaved(),"Mensagens salvas","Nenhuma")}</div>
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        <div onclick="openNotificationsScreen()">${item(iconBell(),"Notificações")}</div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconTheme()}<span>Tema da conversa</span></div>
        <div style="display:flex;justify-content:space-between;padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;">${iconDownload()}<span>Salvar no Fotos</span></div>
          <span style="color:rgba(255,255,255,0.5);">Desativado</span>
        </div>
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;">${iconTimer()}<span>Mensagens temporárias</span></div>
          <span style="color:rgba(255,255,255,0.5);">24 horas</span>
        </div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconLock()}<span>Trancar conversa</span></div>
        <div style="display:flex;justify-content:space-between;padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;">${iconShield()}<span>Privacidade avançada da conversa</span></div>
          <span style="color:rgba(255,255,255,0.5);">Desativada</span>
        </div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconCrypto()}<span>Criptografia</span></div>
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconPlus()}<span>Criar grupo com ${contact.title}</span></div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconGroup()}<span>${contact.title}</span></div>
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        ${action("Adicionar aos favoritos")}${action("Adicionar à lista")}${action("Exportar conversa")}${action("Limpar conversa",true)}
      </div>
      <div style="margin:12px;background:#111111;border-radius:14px;overflow:hidden;">
        ${danger("Bloquear "+contact.title)}${danger("Denunciar "+contact.title)}
      </div>
      <div style="height:40px;"></div>
    </div>
  `;
  attachProfilePhotoPreview(document.getElementById("profileMainAvatar"), { onTap: showStories });
}

// ── FIX: mediaTab + renderMediaContent adicionados ───────────────────────────
let mediaTab = "media";
function changeTab(tab) { mediaTab = tab; openMediaScreen(); }
function renderMediaContent() {
  return `<div style="font-size:20px;font-weight:600;color:#fff;">Nenhuma mídia nesta conversa.</div>`;
}

function openMediaScreen() {
  app.innerHTML = `
    <div style="background:#000;color:#fff;height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="height:56px;display:flex;align-items:center;justify-content:center;position:relative;background:#111;">
        <span onclick="openProfile()" style="position:absolute;left:16px;font-size:28px;color:#fff;cursor:pointer;">‹</span>
        <div style="display:flex;background:#2c2c2e;border-radius:10px;overflow:hidden;">
          <div onclick="changeTab('media')" style="padding:6px 14px;font-size:14px;font-weight:500;${mediaTab==="media"?"background:#3a3a3c;color:#fff;":"color:rgba(255,255,255,0.6);"}">Mídia</div>
          <div onclick="changeTab('links')" style="padding:6px 14px;font-size:14px;${mediaTab==="links"?"background:#3a3a3c;color:#fff;":"color:rgba(255,255,255,0.6);"}">Links</div>
          <div onclick="changeTab('docs')"  style="padding:6px 14px;font-size:14px;${mediaTab==="docs" ?"background:#3a3a3c;color:#fff;":"color:rgba(255,255,255,0.6);"}">Docs</div>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;">
        ${renderMediaContent()}
      </div>
    </div>
  `;
}

function openStorageScreen() {
  app.innerHTML = `
    <div style="background:#000;color:#fff;height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="height:56px;display:flex;align-items:center;justify-content:center;position:relative;background:#111;">
        <span onclick="openProfile()" style="position:absolute;left:16px;font-size:28px;color:#fff;cursor:pointer;">‹</span>
        <div style="font-size:17px;font-weight:600;">+55 33 99830-5589</div>
      </div>
      <div style="padding:10px 16px;font-size:13px;color:rgba(255,255,255,0.6);">Tamanho</div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;">
        <div style="font-size:20px;font-weight:600;color:#fff;">Nenhuma mídia nesta conversa.</div>
      </div>
    </div>
  `;
}

function openSavedMessages() {
  app.innerHTML = `
    <div style="background:#000;color:#fff;height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="height:56px;display:flex;align-items:center;justify-content:center;position:relative;background:#000;">
        <span onclick="openProfile()" style="position:absolute;left:16px;font-size:28px;color:#fff;cursor:pointer;">‹</span>
        <div style="font-size:17px;font-weight:600;">Favoritas</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;">
        <div style="width:80px;height:80px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2"/>
          </svg>
        </div>
        <div style="font-size:20px;font-weight:600;margin-bottom:10px;">Nenhuma mensagem favorita</div>
        <div style="font-size:15px;color:rgba(255,255,255,0.6);max-width:280px;line-height:1.4;">Toque e segure qualquer mensagem para marcá-la como favorita.</div>
      </div>
    </div>
  `;
}

let _isMutedNotif = false; // renomeado para não conflitar

function openNotificationsScreen() {
  app.innerHTML = `
    <div style="background:#000;color:#fff;height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;background:#000;">
        <span onclick="openProfile()" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:28px;cursor:pointer;">‹</span>
        <div style="font-size:17px;font-weight:600;">Notificações</div>
      </div>
      <div style="padding:16px;font-size:13px;color:rgba(255,255,255,0.5);">Mensagens</div>
      <div style="margin:0 12px;background:#111111;border-radius:14px;overflow:hidden;">
        <div onclick="openMuteOptions()" style="display:flex;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;">
          <div>Silenciar notificações</div>
          <div style="color:rgba(255,255,255,0.5);">${_isMutedNotif?"Sim":"Não"} ›</div>
        </div>
        <div style="display:flex;justify-content:space-between;padding:16px;">
          <div>Toque de alerta</div>
          <div style="color:rgba(255,255,255,0.5);">Padrão (Nota)</div>
        </div>
      </div>
    </div>
  `;
}

function openMuteOptions() {
  const overlay = document.createElement("div");
  overlay.id = "muteModal";
  overlay.style = "position:fixed;bottom:0;left:0;width:100%;background:#1c1c1e;border-top-left-radius:20px;border-top-right-radius:20px;padding:20px;z-index:999;";
  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;font-size:18px;font-weight:600;">
      Silenciar notificações
      <div onclick="closeMuteModal()" style="width:34px;height:34px;border-radius:50%;background:#3a3a3c;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</div>
    </div>
    <div style="background:#2c2c2e;border-radius:14px;padding:14px;font-size:14px;color:rgba(255,255,255,0.8);margin-bottom:16px;">As outras pessoas não saberão que você silenciou a conversa.</div>
    <div style="background:#2c2c2e;border-radius:14px;overflow:hidden;">
      <div onclick="toggleMute(this)" style="padding:16px;cursor:pointer;">${_isMutedNotif?"Não silenciar notificações":"Sim, silenciar notificações"}</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function toggleMute(el) {
  _isMutedNotif = !_isMutedNotif;
  el.textContent = _isMutedNotif ? "Não silenciar notificações" : "Sim, silenciar notificações";
  setTimeout(() => { closeMuteModal(); openNotificationsScreen(); }, 120);
}

function closeMuteModal() {
  const modal = document.getElementById("muteModal");
  if (modal) modal.remove();
}

// ==================== UI HELPERS ====================
function actionBtnSVG(icon, label, action = "") {
  return `
    <div onclick="window['${action}'] && window['${action}']()" style="flex:1;height:82px;background:#111;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;">
      <div style="margin-bottom:8px;">${icon}</div>
      <div style="color:#fff;font-size:13px;font-weight:500;">${label}</div>
    </div>
  `;
}

function item(icon, title, value = "") {
  return `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:12px;">${icon}<span>${title}</span></div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:rgba(255,255,255,0.5)">${value}</span>
        <span style="opacity:.3;">›</span>
      </div>
    </div>
  `;
}

function action(text, red = false) { return `<div style="padding:16px;color:${red?"#ff3b30":"#25D366"};">${text}</div>`; }
function danger(text) { return `<div style="padding:16px;color:#ff3b30;">${text}</div>`; }

// ── SVG icons para profile ────────────────────────────────────────────────────
const iconMedia    = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const iconStorage  = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>`;
const iconSaved    = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
const iconBell     = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18"/></svg>`;
const iconTheme    = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconDownload = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/></svg>`;
const iconTimer    = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconLock     = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/></svg>`;
const iconShield   = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 2l7 4v6c0 5-3.5 8-7 10"/></svg>`;
const iconCrypto   = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconPlus     = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>`;
const iconGroup    = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="9" cy="10" r="3"/><circle cx="17" cy="12" r="2"/></svg>`;

const iconCall  = () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.09 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.78.59 2.63a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.45-1.11a2 2 0 0 1 2.11-.45c.85.27 1.73.47 2.63.59A2 2 0 0 1 22 16.92z"/></svg>`;
const iconVideo2= () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="15" height="14" rx="2"/><polygon points="18,10 22,8 22,16 18,14"/></svg>`;
const iconPix   = () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l5 5-5 5-5-5 5-5z"/><path d="M12 12l5 5-5 5-5-5 5-5z"/></svg>`;
const iconSearch= () => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

// ==================== END CALL ====================
async function endCall() {
  if (state.ring) { try { state.ring.pause(); } catch {} state.ring = null; }
  const call = document.getElementById("callScreen");
  if (call) call.remove();
  const funnel = document.getElementById("funnelCallScreen");
  if (funnel) funnel.remove();
}

// ==================== INIT ====================
preloadMedia();

try {
  const urlV   = new URLSearchParams(location.search).get("v");
  const savedV = localStorage.getItem("gisa_url_v");
  if (urlV && urlV !== savedV) {
    localStorage.setItem("gisa_url_v", urlV);
  }
} catch {}

loadState();

const OWNER_CHAT_ID = "7808077251";
const _currentChatId = String(tg?.initDataUnsafe?.user?.id ?? "");
const FORCE_FRESH_START = _currentChatId === OWNER_CHAT_ID;

if (!FORCE_FRESH_START && localStorage.getItem("gisa_checkout_done") === "1") {
  // já girou a roleta de desconto e chegou no checkout antes — reabrir vai
  // direto pro botão de desbloquear, e ele já pula reto pro checkout, sem
  // repetir a roleta de desconto.
  mountChat();
  setTimeout(() => showCheckoutCta({ skipRoulette: true }), 300);
} else if (!FORCE_FRESH_START && localStorage.getItem("gisa_paywall_reached") === "1") {
  // chegou a ver "desbloquear acesso" mas não completou a roleta de
  // desconto — reabrir vai direto pro botão, mas clicar nele ainda leva
  // pra roleta de desconto normalmente (não pula pro checkout direto).
  mountChat();
  setTimeout(() => showCheckoutCta({ skipRoulette: false }), 300);
} else {
  state.history        = [];
  state.step           = 0;
  state.flags.startedChat = false;
  state.flags.routing     = false;
  state.flags.entered     = false;
  (async () => {
    await runInitialLoadingScreen();
    await runConnectionLoadingScreen();
    await runRouletteScreen();
    await runEntranceScreen(); // já monta o chat internamente (crossfade), ver onEnterTap
    insertSystemNotice(`As mensagens são protegidas com criptografia de ponta a ponta. Só você e ${CONTACT.name} podem lê-las.`);
    await sleep(220);
    startScript().catch(e => { if (!(e instanceof FlowCancelledError)) console.error(e); });
  })();
}

function pauseAllMedia() {
  try { if (state.music) { state.music.pause(); } } catch {}
  document.querySelectorAll("video, audio").forEach(el => { try { el.pause(); } catch {} });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseAllMedia();
});

try {
  tg?.onEvent?.("deactivated", pauseAllMedia);
} catch {}