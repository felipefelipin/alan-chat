const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (typeof tg.disableVerticalSwipes === "function") {
    tg.disableVerticalSwipes();
  }
}

const app = document.getElementById("app");

const ASSETS = {
  privateIntro: "/assets/private-intro-v1.mp4",
  privateMusic: "/assets/private-music.mp3",
  intro: "/assets/intro.mp4",
  callVideo: "/assets/call.mp4",
  ringtone: "/assets/ringtone.mp3",
  avatar: "/assets/avatar-gisa.jpg",
  media1: "/assets/grid-1.jpg",
  media2: "/assets/grid-2.jpg",
  media3: "/assets/grid-3.jpg",
  media4: "/assets/grid-4.jpg",
};

function preloadMedia() {
  try {
    const v = document.createElement("video");
    v.src = ASSETS.privateIntro;
    v.preload = "auto";
  } catch {}

  try {
    const a = new Audio();
    a.src = ASSETS.privateMusic;
    a.preload = "auto";
  } catch {}
}

async function fadeVolume(audio, from, to, ms = 700) {
  if (!audio) return;

  const steps = Math.max(10, Math.floor(ms / 60));
  const stepMs = Math.floor(ms / steps);

  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * p));
    await new Promise(r => setTimeout(r, stepMs));
  }
}

const CONTACT = {
  title: "Gisa",
  subtitle: "online agora",
  number: "+55 33 99848-1169",
};

const PERSIST_KEY = "gisa_webapp_state_v6";
const CHECKOUT_URL = "/checkout";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const state = {
  step: 0,
  ring: null,
  chatEl: null,
  music: null,
  introVidEl: null,
  history: [],
  flags: {
    entered: false,
    audioEnabled: false,
    routing: false,
    startedChat: false,
  },
};

let isUserNearBottom = true;

function snapshotForSave() {
  return {
    step: state.step,
    flags: {
      entered: !!state.flags.entered,
      audioEnabled: !!state.flags.audioEnabled,
      routing: false,
      startedChat: !!state.flags.startedChat,
    },
    history: Array.isArray(state.history) ? state.history.slice(-220) : [],
    ui: {
      statusText: document.getElementById("status")?.textContent ?? CONTACT.subtitle,
    },
  };
}

function saveState() {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshotForSave()));
  } catch {}
}

function loadState() {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return;

  const data = safeJsonParse(raw);
  if (!data) return;

  if (typeof data.step === "number") {
    state.step = data.step;
  }

  if (data.flags && typeof data.flags === "object") {
    state.flags.entered = !!data.flags.entered;
    state.flags.audioEnabled = !!data.flags.audioEnabled;
    state.flags.startedChat = !!data.flags.startedChat;
    state.flags.routing = false;
  }

  if (Array.isArray(data.history)) {
    state.history = data.history;
  }
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
  saveState();
}

function vibrate(ms = 18) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}

// ==================== KEYBOARD UX - VERSÃO FOCADA EM ELIMINAR JUMP ====================
function bindKeyboardUX() {
  const input = document.getElementById("input");
  const chat = document.getElementById("chat");
  if (!input || !chat) return;

  let startY = 0;
  let lastY = 0;
  let totalDelta = 0;
  let direction = null;
  let isKeyboardOpen = false;

  input.addEventListener("focus", () => {
    document.body.classList.add("kb-open");
    isKeyboardOpen = true;

    // Técnica anti-jump: estabiliza o chatShell antes do teclado subir
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (state.chatEl) {
          state.chatEl.style.paddingBottom = "10px";
          void state.chatEl.offsetHeight; // força repaint
        }
      });
    });
  });

  input.addEventListener("blur", () => {
    document.body.classList.remove("kb-open");
    isKeyboardOpen = false;
  });

  // Gesture swipe-up para fechar
  chat.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    lastY = startY;
    totalDelta = 0;
    direction = null;
  }, { passive: true });

  chat.addEventListener("touchmove", (e) => {
    const currentY = e.touches[0].clientY;
    const delta = currentY - lastY;
    totalDelta += delta;

    if (Math.abs(totalDelta) > 12) {
      direction = totalDelta > 0 ? "down" : "up";
    }

    lastY = currentY;
  }, { passive: true });

  chat.addEventListener("touchend", () => {
    if (!isKeyboardOpen) return;

    const strongSwipeUp = direction === "up" && Math.abs(totalDelta) > 70;

    if (strongSwipeUp) {
      input.blur();
    }
  });
}

function getFlowTypes() {
  return new Set(["msg", "video", "cta", "mediaGrid", "audio"]);
}

function updatePreviousGroupForNewMessage(side) {
  const flowTypes = getFlowTypes();

  for (let i = state.history.length - 1; i >= 0; i--) {
    const item = state.history[i];
    if (!item || item.side !== side) break;
    if (!flowTypes.has(item.type)) break;

    if (item.cluster === "single") item.cluster = "first";
    else if (item.cluster === "last") item.cluster = "middle";
    else if (item.cluster === "first") item.cluster = "first";
    else if (item.cluster === "middle") item.cluster = "middle";

    break;
  }
}

function getNewCluster(side) {
  const flowTypes = getFlowTypes();
  const last = state.history[state.history.length - 1];
  if (!last) return "single";
  if (last.side !== side) return "single";
  if (!flowTypes.has(last.type)) return "single";
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
  return [
    18, 30, 42, 37, 28, 24, 32, 48, 26, 20, 14, 12,
    16, 18, 26, 34, 46, 41, 29, 18, 14, 20, 28, 39,
    22, 18, 13, 16, 21, 30, 26, 22,
  ];
}

function mountPremiumIntro() {
  const cacheBust = `?v=${Date.now()}`;

  app.innerHTML = `
    <div class="pIntro">
      <div class="pIntroVideoWrap">
        <video
          id="pIntroVid"
          playsinline
          muted
          preload="auto"
          src="${ASSETS.privateIntro + cacheBust}"
        ></video>

        <div class="pIntroTop">
          <div class="pIntroChip">acesso privado</div>
          <div class="pIntroTimer"><span id="pT">0:10</span></div>
        </div>

        <div class="pIntroOverlay" id="pOverlay">
          <div class="pIntroTitle">conexão exclusiva</div>
          <div class="pIntroSub" id="pSub">toque para ativar o som</div>

          <div class="pRow">
            <button id="pEnableAudio" class="pBtnGhost">ativar som</button>
          </div>
        </div>

        <div class="pProgress">
          <div class="pProgBar" id="pProg"></div>
        </div>

        <div class="pCtaWrap" id="pCtaWrap">
          <button id="pEnterChat" class="pBtnPrimary">entrar na conversa</button>
        </div>
      </div>
    </div>
  `;

  const vid = document.getElementById("pIntroVid");
  const btnAudio = document.getElementById("pEnableAudio");
  const ctaWrap = document.getElementById("pCtaWrap");
  const btnEnter = document.getElementById("pEnterChat");
  const sub = document.getElementById("pSub");
  const prog = document.getElementById("pProg");
  const tEl = document.getElementById("pT");

  state.introVidEl = vid;

  ctaWrap.classList.remove("show");
  ctaWrap.style.pointerEvents = "none";

  const tryPlayVideo = async () => {
    try {
      await vid.play();
      return true;
    } catch {
      return false;
    }
  };

  const tryEnableAudio = async () => {
    if (state.flags.audioEnabled) return true;

    try {
      if (!state.music) {
        state.music = new Audio(ASSETS.privateMusic + `?v=${Date.now()}`);
      }

      state.music.loop = false;
      state.music.currentTime = 0;
      state.music.volume = 0;
      await state.music.play();

      state.flags.audioEnabled = true;
      saveState();

      await fadeVolume(state.music, 0, 0.9, 750);

      if (btnAudio) {
        btnAudio.textContent = "som ativado ✓";
        btnAudio.disabled = true;
      }

      if (sub) sub.textContent = "pronto… só mais alguns segundos.";
      return true;
    } catch {
      if (sub) sub.textContent = "toque novamente para ativar";
      return false;
    }
  };

  btnAudio.onclick = async () => {
    await tryPlayVideo();
    await tryEnableAudio();
  };

  vid.addEventListener("click", async () => {
    await tryPlayVideo();
    await tryEnableAudio();
  });

  vid.addEventListener("error", () => {
    if (sub) sub.textContent = "não consegui carregar o vídeo…";
    showCta();
  });

  setTimeout(() => {
    tryPlayVideo();
  }, 150);

  const stopAt = 10.0;
  let ended = false;

  const showCta = () => {
    ctaWrap.classList.add("show");
    ctaWrap.style.pointerEvents = "auto";
  };

  const endIntro = async () => {
    if (ended) return;
    ended = true;

    try {
      vid.pause();
    } catch {}

    try {
      if (state.music && state.flags.audioEnabled) {
        await fadeVolume(state.music, state.music.volume ?? 0.9, 0, 650);
        state.music.pause();
        state.music.currentTime = 0;
      }
    } catch {}

    const overlay = document.getElementById("pOverlay");
    if (overlay) overlay.style.opacity = "0";

    showCta();
    vibrate(14);
  };

  const updateTimer = (secLeft) => {
    const s = Math.max(0, Math.ceil(secLeft));
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    if (tEl) tEl.textContent = `${mm}:${ss}`;
  };

  const tick = setInterval(() => {
    if (!vid) return;

    const p = Math.max(0, Math.min(1, vid.currentTime / stopAt));
    if (prog) prog.style.width = `${Math.floor(p * 100)}%`;

    updateTimer(stopAt - vid.currentTime);

    if (vid.currentTime >= stopAt) {
      clearInterval(tick);
      endIntro();
    }
  }, 90);

  vid.onended = () => {
    clearInterval(tick);
    endIntro();
  };

  btnEnter.onclick = async () => {
    if (state.flags.entered) return;

    state.flags.entered = true;
    saveState();

    try {
      vid.pause();
    } catch {}

    try {
      if (state.music) {
        state.music.pause();
        state.music.currentTime = 0;
      }
    } catch {}

    await runRoutingOverlayV4();
    mountChat();
    await sleep(220);
    startScript();
  };

  setTimeout(() => {
    if (!ended && (!vid || vid.readyState < 2)) {
      showCta();
      if (sub) sub.textContent = "toque para continuar";
    }
  }, 2800);
}

async function runRoutingOverlayV4() {
  if (state.flags.routing) return;
  state.flags.routing = true;

  app.insertAdjacentHTML(
    "beforeend",
    `
    <div class="routeOverlay" id="routeOverlay">
      <div class="routeBox">
        <div class="routeTitle">conectando sessão privada</div>
        <div class="routeLoader"></div>
        <div class="routeSteps">
          <div class="routeStep" id="st1">validando acesso…</div>
          <div class="routeStep" id="st2" style="opacity:.45;">protegendo ambiente…</div>
          <div class="routeStep" id="st3" style="opacity:.45;">sincronizando conversa…</div>
        </div>
      </div>
    </div>
  `
  );

  await sleep(650);

  const st2 = document.getElementById("st2");
  const st3 = document.getElementById("st3");

  if (st2) st2.style.opacity = "1";

  await sleep(950);
  if (st2) st2.innerHTML = `aguarde um instante <span class="dots">…</span>`;

  await sleep(850);
  if (st3) {
    st3.style.opacity = "1";
    st3.innerHTML = `conexão pronta <span class="check">✓</span>`;
  }

  vibrate(16);
  await sleep(520);

  const overlay = document.getElementById("routeOverlay");
  if (overlay) overlay.classList.add("fadeOut");
  await sleep(320);
  if (overlay) overlay.remove();

  state.flags.routing = false;
}

function mountChat() {
  app.innerHTML = `
    <div class="full fadeIn">
      <div class="statusbar">
        <span id="sbTime">${nowTime()}</span>
        <span class="sbIcons">
          <span class="sbSignal"></span>
          <span class="sbWifi"></span>
          <span class="sbBattery"></span>
        </span>
      </div>

      <!-- TOP BAR - VERSÃO CORRIGIDA E ESTÁVEL -->
      <div class="topbar">
        <button class="navBtn" onclick="mountChat()" type="button" aria-label="Voltar">
          <span class="navChevron"></span>
        </button>

        <!-- Foto do perfil clicável para Stories -->
        <div class="avatarWrap">
          <div class="avatar" onclick="showStories()" style="cursor: pointer;">
            <img src="${ASSETS.avatar}?v=1" alt="${CONTACT.title}" />
          </div>
        </div>

        <!-- Nome + Online Agora (do lado da foto) -->
<div class="titlebox" onclick="openProfile()" style="cursor:pointer;">
  
  <div class="name">${CONTACT.title}</div>
  
  <div class="status" id="status">
    ${CONTACT.subtitle}
  </div>

</div>

        <!-- Ícones de chamada à direita -->
<div class="topActions" style="
  display:flex;
  align-items:center;
  gap:18px;
">

  <button style="background:none;border:none;padding:0;">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
    stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="6" width="13" height="12" rx="3"/>
      <path d="M16 10l5-3v10l-5-3z"/>
    </svg>
  </button>

  <button style="background:none;border:none;padding:0;">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 16.92v2.5a1.8 1.8 0 0 1-2 1.8 19 19 0 0 1-8.2-2.9 18.7 18.7 0 0 1-5.8-5.8A19 19 0 0 1 2.68 4 1.8 1.8 0 0 1 4.48 2h2.5a1.8 1.8 0 0 1 1.7 1.5c.12.8.3 1.6.55 2.3a1.8 1.8 0 0 1-.4 1.8L7.9 9.5a15 15 0 0 0 6.6 6.6l1.9-1.4a1.8 1.8 0 0 1 1.8-.4c.7.25 1.5.43 2.3.55A1.8 1.8 0 0 1 22 16.92z"/>
    </svg>
  </button>

</div>

      <div class="chatShell">
        <div class="chat" id="chat"></div>
      </div>

      <div class="composer">
        <button class="composerAttach" type="button">
          <span class="composerPlusMark">+</span>
        </button>

        <div class="composerField">
          <input id="input" autocomplete="off" placeholder="Mensagem" />
        </div>

        <button class="composerGhostBtn" type="button">
          <span class="iconSticker">😀</span>
        </button>

        <button class="composerMic" id="composerMic" type="button">
          <span class="iconMic"></span>
        </button>

        <button class="send is-hidden" id="send" aria-label="Enviar">
          <span class="sendArrow"></span>
        </button>
      </div>
    </div>
  `;

  // Configurações do chat
  const sendBtn = document.getElementById("send");
  const input = document.getElementById("input");
  const micBtn = document.getElementById("composerMic");

  sendBtn.onclick = onSend;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSend();
  });

  input.addEventListener("input", () => {
    const hasText = !!input.value.trim();
    sendBtn.classList.toggle("is-hidden", !hasText);
    micBtn.classList.toggle("is-hidden", hasText);
  });

  state.chatEl = document.getElementById("chat");
  restoreHistory();
  bindKeyboardUX();
  handleScrollDetection();

  setInterval(() => {
    const t = document.getElementById("sbTime");
    if (t) t.textContent = nowTime();
  }, 30000);
}

function scrollBottom(force = false) {
  const el = state.chatEl;
  if (!el) return;

  if (!force && !isUserNearBottom) return;

  // Anti-jump: usa requestAnimationFrame para suavizar o scroll
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}

function removeTyping() {
  const el = document.getElementById("typingRow");
  if (el) el.remove();
}

function handleScrollDetection() {
  const chat = state.chatEl;
  if (!chat) return;

  chat.addEventListener("scroll", () => {
    const threshold = 80;

    const position = chat.scrollTop + chat.clientHeight;
    const height = chat.scrollHeight;

    isUserNearBottom = (height - position) <= threshold;

  }, { passive: true });
}

function addTyping() {
  removeTyping();

  const row = document.createElement("div");
  row.className = "msgRow msg-left is-single";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="bubble bubble-in bubble-typing">
      <div class="typingDots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  `;

  state.chatEl.appendChild(row);
  scrollBottom();
}

function pushHistory(item) {
  state.history.push(item);
  if (state.history.length > 260) state.history = state.history.slice(-260);
  saveState();
}

function renderTicks(item) {
  if (item.side !== "right") return "";
  return `
    <span class="tickWrap" aria-hidden="true">
      <span class="tick tick1"></span>
      <span class="tick tick2"></span>
    </span>
  `;
}

function renderMeta(item) {
  return `
    <div class="meta">
      <span class="metaTime">${item.time || nowTime()}</span>
      ${renderTicks(item)}
    </div>
  `;
}

function renderMediaGrid(item) {
  const items = Array.isArray(item.items) ? item.items : getDefaultGridItems();

  return `
    <div class="mediaGrid">
      ${items.map((m, index) => `
        <div class="mediaGridItem" data-index="${index}">
          <img src="${m.src}" alt="" onerror="this.style.display='none'" />
          <div class="mediaGridOverlay">
            <span class="mediaPlay"></span>
          </div>
          <div class="mediaDuration">${m.duration || "0:08"}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAudioBubble(item) {
  const bars = Array.isArray(item.bars) && item.bars.length ? item.bars : getDefaultWaveBars();

  return `
    <div class="audioBubbleShell">
      <button class="audioPlayFake" type="button" aria-hidden="true">
        <span class="audioPlayTriangle"></span>
      </button>

      <div class="audioWaveWrap">
        <div class="audioWave">
          ${bars.map((h, i) => `<span class="waveBar ${i < 6 ? "isPlayed" : ""}" style="height:${h}px"></span>`).join("")}
        </div>

        <div class="audioMetaRow">
          <span class="audioStart">${item.start || "0:09"}</span>
          <span class="audioEnd">${item.end || "10:00"}</span>
        </div>
      </div>

      <button class="audioMicFake" type="button" aria-hidden="true">
        <span class="audioMicIcon"></span>
      </button>

      <div class="audioAvatarMini avatarImgWrap">
        <img
          src="${ASSETS.avatar}?v=1"
          alt="${CONTACT.title}"
          onerror="this.parentNode.classList.add('avatarFallback')"
        />
        <span class="avatarFallbackText">${CONTACT.title.charAt(0)}</span>
      </div>
    </div>
  `;
}

function renderRowHTML(item, animated = false) {
  const sideClass = item.side === "right" ? "msg-right" : "msg-left";
  const clusterClass = `is-${item.cluster || "single"}`;
  const bubbleBase = item.side === "right" ? "bubble-out" : "bubble-in";
  const anim = animated ? "popIn" : "";

  if (item.type === "msg") {
    return `
      <div class="msgRow ${sideClass} ${clusterClass}">
        <div class="bubble ${bubbleBase} ${anim}">
          <div class="bubbleText">${item.html}</div>
          ${renderMeta(item)}
        </div>
      </div>
    `;
  }

  if (item.type === "video") {
    return `
      <div class="msgRow ${sideClass} ${clusterClass}">
        <div class="bubble ${bubbleBase} bubble-media ${anim}">
          <div class="videoBubble">
            <video playsinline muted preload="auto" ${animated ? "autoplay" : ""} src="${item.src}"></video>
            <div class="videoHint">vídeo</div>
          </div>
          ${renderMeta(item)}
        </div>
      </div>
    `;
  }

  if (item.type === "mediaGrid") {
    return `
      <div class="msgRow ${sideClass} ${clusterClass}">
        <div class="bubble ${bubbleBase} bubble-grid ${anim}">
          ${renderMediaGrid(item)}
          ${renderMeta(item)}
        </div>
      </div>
    `;
  }

  if (item.type === "audio") {
    return `
      <div class="msgRow ${sideClass} ${clusterClass}">
        <div class="bubble ${bubbleBase} bubble-audio ${anim}">
          ${renderAudioBubble(item)}
          ${renderMeta(item)}
        </div>
      </div>
    `;
  }

  if (item.type === "cta") {
    return `
      <div class="msgRow ${sideClass} ${clusterClass}">
        <div class="bubble ${bubbleBase} bubble-card ${anim}">
          ${item.html}
          ${renderMeta(item)}
        </div>
      </div>
    `;
  }

  return "";
}

function renderItem(item, animated = false) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderRowHTML(item, animated).trim();
  const row = wrapper.firstElementChild;
  if (row) state.chatEl.appendChild(row);
  return row;
}

function rerenderHistory() {
  if (!state.chatEl) return;
  state.chatEl.innerHTML = "";
  rebuildClusters();

  for (const item of state.history) {
    if (!item || !item.type) continue;
    renderItem(item, false);
  }

  scrollBottom(false);
}

function restoreHistory() {
  if (!state.chatEl) return;
  if (!Array.isArray(state.history)) return;

  state.chatEl.innerHTML = "";

  for (const item of state.history) {
    renderItem(item, false);
  }

  scrollBottom(true);
}

function addMsg(side, html) {
  updatePreviousGroupForNewMessage(side);

  const item = {
    type: "msg",
    side,
    html,
    time: nowTime(),
    cluster: getNewCluster(side),
  };

  pushHistory(item);

  renderItem(item, true);
  scrollBottom();
}

function addVideoBubble(src, seconds = 10) {
  updatePreviousGroupForNewMessage("left");

  const item = {
    type: "video",
    side: "left",
    src: `${src}?v=${Date.now()}`,
    time: nowTime(),
    cluster: getNewCluster("left"),
  };

  pushHistory(item);

  renderItem(item, true);
  scrollBottom();
}

function addMediaGridBubble(items = null) {
  updatePreviousGroupForNewMessage("left");

  const item = {
    type: "mediaGrid",
    side: "left",
    items: items || getDefaultGridItems(),
    time: nowTime(),
    cluster: getNewCluster("left"),
  };

  pushHistory(item);

  renderItem(item, true);
  scrollBottom();
}

function addAudioBubble(data = {}) {
  updatePreviousGroupForNewMessage("left");

  const item = {
    type: "audio",
    side: "left",
    bars: data.bars || getDefaultWaveBars(),
    start: data.start || "0:09",
    end: data.end || "10:00",
    time: nowTime(),
    cluster: getNewCluster("left"),
  };

  pushHistory(item);

  renderItem(item, true);
  scrollBottom();
}

function addCtaCard(html) {
  updatePreviousGroupForNewMessage("left");

  const item = {
    type: "cta",
    side: "left",
    html,
    time: nowTime(),
    cluster: getNewCluster("left"),
  };

  pushHistory(item);

  renderItem(item, true);
  scrollBottom();
}

function typingDelayFor(text) {
  const len = String(text).length;
  const base = rand(850, 1450);
  const per = rand(28, 50);
  const jitter = rand(220, 920);
  return Math.min(6200, base + len * per + jitter);
}

async function gisaSay(text, opts = {}) {
  const status = Math.random() < 0.15 ? "gravando áudio…" : "digitando…";

  setStatus(status);
  addTyping();

  await sleep(opts.delay ?? typingDelayFor(text));
  removeTyping();

  await sleep(rand(90, 220));
  setStatus(CONTACT.subtitle);

  addMsg("left", escapeHtml(text).replace(/\n/g, "<br/>"));
  await sleep(rand(320, 760));
}

function onSend() {
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const micBtn = document.getElementById("composerMic");

  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  sendBtn.classList.add("is-hidden");
  micBtn.classList.remove("is-hidden");

  addMsg("right", escapeHtml(text));
  handleUserText(text);
}

async function startScript() {
  if (state.flags.startedChat) return;
  state.flags.startedChat = true;

  state.step = 0;
  saveState();

  setStatus("enviando vídeo…");
  await sleep(rand(900, 1600));

  addVideoBubble(ASSETS.intro, 10);

  await sleep(rand(700, 1200));
  setStatus(CONTACT.subtitle);

  await gisaSay("tive que te trazer pra cá…");
  await gisaSay("aqui eu consigo fazer tudo com mais privacidade.");
  await sleep(rand(400, 800));
  await gisaSay("mas me responde uma coisa rapidinho…");
  await gisaSay("você é mais curioso…\nou vai até o fim?");

  state.step = 1;
  saveState();
}

async function handleUserText(text) {
  if (state.step === 1) {
    state.step = 2;
    saveState();

    await gisaSay("hm…");
    await gisaSay("foi o que eu imaginei");
    await sleep(rand(700, 1200));
    await gisaSay("posso te mostrar rapidinho por chamada?");
    state.step = 3;
    saveState();
    return;
  }

  if (state.step === 3) {
    state.step = 4;
    saveState();

    await gisaSay("ok… espera.");
    await gisaSay("não some.");
    await sleep(rand(900, 1500));
    showIncomingCall();
  }
}

function openCheckout() {
  try {
    if (tg?.openLink) tg.openLink(CHECKOUT_URL);
    else window.location.href = CHECKOUT_URL;
  } catch {
    window.location.href = CHECKOUT_URL;
  }
}

function showCheckoutCta() {
  const html = `
    <div class="ctaCardWrap">
      <div class="ctaEyebrow">acesso protegido</div>
      <div class="ctaTitle">se você quer que eu continue… é por aqui.</div>
      <div class="ctaText">abre o checkout em ambiente seguro</div>
      <button id="goCheckoutBtn" class="pBtnPrimary ctaPrimary">continuar</button>
    </div>
  `;

  addCtaCard(html);

  setTimeout(() => {
    const btn = document.getElementById("goCheckoutBtn");
    if (btn) btn.onclick = openCheckout;
  }, 0);
}

function showIncomingCall() {
  try {
    state.ring = new Audio(ASSETS.ringtone + `?v=${Date.now()}`);
    state.ring.loop = true;
    state.ring.play().catch(() => {});
  } catch {}

  // Aqui só criamos a tela de chamada (sem aninhar outras funções)
  app.insertAdjacentHTML("beforeend", `
    <div class="callScreen" id="callScreen">
      <div class="callAmbient"></div>

      <div class="callCenter">
        <div class="avatar callAvatar avatarImgWrap">
          <img src="${ASSETS.avatar}?v=1" alt="${CONTACT.title}" />
          <span class="avatarFallbackText">${CONTACT.title.charAt(0)}</span>
        </div>

        <div class="callName">${CONTACT.title}</div>
        <div class="callSub">chamada de vídeo…</div>
      </div>

      <div class="callActions">
        <button class="callActionWrap" id="decline" type="button">
          <span class="btnRed"></span>
          <span class="callActionLabel">Recusar</span>
        </button>

        <button class="callActionWrap" id="accept" type="button">
          <span class="btnGreen"></span>
          <span class="callActionLabel">Atender</span>
        </button>
      </div>
    </div>
  `);
}

(function initStoryVideo() {
  if (document.getElementById("storyVideo")) return;

  const video = document.createElement("video");
  video.id = "storyVideo";

  video.src = "/assets/story-video.mp4";
  video.preload = "auto";
  video.muted = false;
  video.playsInline = true;

  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "0";
  video.style.width = "100vw";
  video.style.height = "100dvh";
  video.style.objectFit = "cover";
  video.style.zIndex = "0";
  video.style.display = "none";

  document.body.appendChild(video);

  // 🔥 força carregamento antecipado
  video.load();
})();

function showStories() {
  console.log("📸 Stories aberto");

  const video = document.getElementById("storyVideo");

  // 🔥 TRAVA ALTURA ORIGINAL UMA ÚNICA VEZ
  if (!window.__storyHeight) {
    window.__storyHeight = window.innerHeight;
  }

  const realHeight = window.__storyHeight;

  // 🔥 NÃO troca src (ESSENCIAL PRO ZERO DELAY)
  if (!video.src) {
    video.src = "/assets/story-video.mp4";
  }

  video.style.display = "block";
  video.currentTime = 0;

  video.style.position = "fixed";
  video.style.top = "0";
  video.style.left = "0";
  video.style.width = "100vw";
  video.style.height = realHeight + "px";
  video.style.objectFit = "cover";
  video.style.zIndex = "0";
  video.style.transform = "translateZ(0)";
  video.style.willChange = "transform";

  // 🔥 play só depois que pode tocar (evita tela preta)
  if (video.readyState >= 2) {
    video.play().catch(() => {});
  } else {
    video.oncanplay = () => {
      video.play().catch(() => {});
    };
  }

  app.innerHTML = `
    <div class="full" style="
      background:transparent;
      position:relative;
      overflow:hidden;
      height:${realHeight}px;
    ">

      <!-- PROGRESS -->
      <div style="
        position:absolute;
        top:0;
        left:0;
        right:0;
        height:3px;
        background:rgba(255,255,255,0.22);
        z-index:20;
      ">
        <div id="progressBar" style="
          height:100%;
          width:0%;
          background:#fff;
        "></div>
      </div>

      <!-- HEADER -->
      <div style="
        position:absolute;
        top:8px;
        left:14px;
        right:14px;
        display:flex;
        align-items:flex-start;
        z-index:30;
      ">

        <button onclick="exitStories()" style="
          background:none;
          border:0;
          color:#fff;
          font-size:34px;
          margin-right:10px;
          padding:0;
          line-height:1;
        ">‹</button>

        <div style="
          width:42px;
          height:42px;
          margin-right:10px;
          border-radius:50%;
          overflow:hidden;
          flex-shrink:0;
        ">
          <img
            src="${ASSETS.avatar}?v=1"
            style="
              width:100%;
              height:100%;
              object-fit:cover;
            "
          />
        </div>

        <div style="margin-top:1px;">
          <div style="
            color:#fff;
            font-weight:600;
            font-size:15px;
            line-height:1.1;
          ">
            ${CONTACT.title}
          </div>

          <div style="
            color:rgba(255,255,255,0.85);
            font-size:12px;
            margin-top:2px;
            line-height:1;
          ">
            12h
          </div>
        </div>

      </div>

      <!-- RESPOSTA -->
      <div id="replyBar" style="
        position:absolute;
        bottom:0;
        left:0;
        right:0;
        padding:12px 16px 20px;
        background:linear-gradient(to top, rgba(0,0,0,.92), transparent);
        z-index:40;
      ">
        <div onclick="openStoryReply()" style="
          background:rgba(255,255,255,.14);
          border-radius:30px;
          padding:14px 20px;
          color:#fff;
          display:flex;
          align-items:center;
        ">
          <span style="flex:1;">Responder...</span>
          <div style="
  width:48px;
  height:48px;
  margin-left:10px;
  border-radius:50%;
  background:rgba(255,255,255,0.12);
  backdrop-filter:blur(10px);
  display:flex;
  align-items:center;
  justify-content:center;
">

  <svg viewBox="0 0 24 24"
    fill="none"
    stroke="white"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    style="width:22px;height:22px;">
    
    <path d="M20.4 4.6c-1.4-1.5-3.7-1.5-5.1 0L12 7.7l-3.3-3.1c-1.4-1.5-3.7-1.5-5.1 0-1.5 1.5-1.5 3.9 0 5.4L12 20l8.4-10c1.5-1.5 1.5-3.9 0-5.4z"/>
  
  </svg>

</div>
      </div>

      <!-- PRELOAD TURBO INPUT -->
      <div id="storyReplyTurbo" style="
        position:absolute;
        opacity:0;
        pointer-events:none;
        left:-9999px;
        top:-9999px;
        z-index:-1;
      ">
        <input
          id="storyTurboInput"
          type="text"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>

    </div>
  `;

  const progress = document.getElementById("progressBar");

  let progressInterval = null;

  // 🔥 progresso sincronizado
  video.onplay = () => {
    clearInterval(progressInterval);

    progressInterval = setInterval(() => {
      if (!video.duration) return;

      const percent = (video.currentTime / video.duration) * 100;

      if (progress) {
        progress.style.width = percent + "%";
      }
    }, 50);
  };

  video.onpause = () => {
    clearInterval(progressInterval);
  };

  video.onended = () => {
    clearInterval(progressInterval);
    exitStories();
  };
}

function openStoryReply() {
  // evita duplicação
  if (document.getElementById("storyReplyOverlay")) return;

  const video = document.getElementById("storyVideo");
  const oldBar = document.getElementById("replyBar");

  // pausa vídeo
  if (video) video.pause();

  // esconde barra antiga
  if (oldBar) oldBar.style.display = "none";

  // trava scroll leve (sem body fixed pesado)
  document.body.style.overflow = "hidden";

  const html = `
    <div id="storyReplyOverlay" style="
      position:fixed;
      inset:0;
      z-index:9999;
    ">

      <div class="story-hint">Toque para enviar</div>

      <!-- EMOJIS -->
      <div class="story-emojis">

  <div class="emoji-row">
    <span onclick="sendStoryReaction(this)">😍</span>
    <span onclick="sendStoryReaction(this)">😂</span>
    <span onclick="sendStoryReaction(this)">😮</span>
    <span onclick="sendStoryReaction(this)">😢</span>
  </div>

  <div class="emoji-row">
    <span onclick="sendStoryReaction(this)">🙏</span>
    <span onclick="sendStoryReaction(this)">👏</span>
    <span onclick="sendStoryReaction(this)">🎉</span>
    <span onclick="sendStoryReaction(this)">💯</span>
  </div>

</div>

      <!-- INPUT -->
      <div class="story-input-bar" id="replyBarKeyboard">

        <span class="plus-btn">＋</span>

        <div class="story-input-wrap">
          <input
            id="storyReplyInput"
            type="text"
            placeholder=""
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <span class="side-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h4l2-2h4l2 2h4v12H4z"/>
            <circle cx="12" cy="13" r="3.5"/>
          </svg>
        </span>

        <span class="side-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="3" width="6" height="12" rx="3"/>
            <path d="M6 11a6 6 0 0 0 12 0"/>
            <path d="M12 17v4"/>
          </svg>
        </span>

      </div>

    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);

  const overlay = document.getElementById("storyReplyOverlay");
  const input = document.getElementById("storyReplyInput");
  const replyBar = document.getElementById("replyBarKeyboard");

  // estado inicial
  replyBar.style.opacity = "1";
  replyBar.style.bottom = "10px";
  replyBar.style.transform = "translateY(0)";

  // 🔥 teclado turbo universal
  input.focus();
  input.click();

  try {
    input.setSelectionRange(
      input.value.length,
      input.value.length
    );
  } catch (e) {}

  if (window.Telegram?.WebApp) {
    Telegram.WebApp.expand();
  }

  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.click();
  });

  // 🔥 detector profissional sem lag
  let keyboardOpen = false;

  const handleViewport = () => {
    const vh = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;

    const full = window.innerHeight;
    const keyboard = full - vh;

    // abriu teclado
    if (keyboard > 120 && !keyboardOpen) {
      keyboardOpen = true;

      replyBar.style.transition = "none";
      replyBar.style.transform = "translateY(-320px)";
    }

    // fechou teclado
    if (keyboard < 80 && keyboardOpen) {
      keyboardOpen = false;

      replyBar.style.transition = "none";
      replyBar.style.transform = "translateY(0)";
    }
  };

  window.visualViewport?.addEventListener("resize", handleViewport);

  // salvar listener para remover depois
  overlay._viewportHandler = handleViewport;

  // clique fora fecha
  overlay.addEventListener("click", (e) => {
    if (e.target.id === "storyReplyOverlay") {
      closeStoryReply();
    }
  });
}

function closeStoryReply() {
  const overlay = document.getElementById("storyReplyOverlay");
  if (overlay) overlay.remove();

  // fecha teclado
  const input = document.getElementById("storyReplyInput");
  if (input) input.blur();

  // remove listener viewport salvo no overlay
  if (overlay && overlay._viewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener(
      "resize",
      overlay._viewportHandler
    );
  }

  // restaura body
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.width = "";
  document.body.style.height = "";
  document.body.style.top = "";
  document.body.style.left = "";

  document.documentElement.style.overflow = "";
  document.documentElement.style.height = "";

  // volta barra original
  const oldBar = document.getElementById("replyBar");
  if (oldBar) {
    oldBar.style.display = "block";
    oldBar.style.opacity = "1";
    oldBar.style.transform = "translateY(0)";
  }

  // 🔥 RESET VIEWPORT iPhone / Telegram
  window.scrollTo(0, 0);

  setTimeout(() => {
    window.scrollTo(0, 0);
  }, 30);

  setTimeout(() => {
    window.scrollTo(0, 0);
  }, 120);

  // volta vídeo
  const video = document.getElementById("storyVideo");
  if (video) {
    video.style.position = "fixed";
    video.style.top = "0";
    video.style.left = "0";
    video.style.width = "100vw";
    video.style.height = window.__storyHeight + "px";
    video.style.objectFit = "cover";
    video.style.transform = "translateZ(0)";
    video.style.willChange = "transform";

    video.play().catch(() => {});
  }
}

function exitStories() {
  const video = document.getElementById("storyVideo");

  if (video) {
    video.pause();
    video.currentTime = 0;
    video.style.display = "none"; // 🔥 ESSENCIAL
  }

  mountChat();
}

function sendStoryReaction(emojiEl) {
  if (!emojiEl) return;

  const avatar = document.querySelector(".full img");
  if (!avatar) return;

  const emoji = emojiEl.textContent.trim();

  // 🔥 vibração real
  try {
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 60]);
    }
  } catch (e) {}

  const from = emojiEl.getBoundingClientRect();
  const to = avatar.getBoundingClientRect();

  const fly = document.createElement("div");
  fly.textContent = emoji;

  fly.style.position = "fixed";
  fly.style.left = from.left + from.width / 2 + "px";
  fly.style.top = from.top + from.height / 2 + "px";
  fly.style.fontSize = "34px";
  fly.style.zIndex = "999999";
  fly.style.pointerEvents = "none";
  fly.style.transition =
    "transform .65s cubic-bezier(.22,.8,.22,1), opacity .65s ease";

  document.body.appendChild(fly);

  const dx =
    to.left + to.width / 2 -
    (from.left + from.width / 2);

  const dy =
    to.top + to.height / 2 -
    (from.top + from.height / 2);

  // fecha overlay
  closeStoryReply();

  requestAnimationFrame(() => {
    fly.style.transform =
      `translate(${dx}px, ${dy}px) scale(.18)`;
    fly.style.opacity = "0";
  });

  // 🔥 toast inline garantido
  const toast = document.createElement("div");
  toast.textContent = "Enviando resposta...";
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.bottom = "120px";
  toast.style.transform = "translateX(-50%)";
  toast.style.background = "rgba(18,18,18,.92)";
  toast.style.color = "#fff";
  toast.style.padding = "12px 18px";
  toast.style.borderRadius = "999px";
  toast.style.fontSize = "15px";
  toast.style.fontWeight = "500";
  toast.style.zIndex = "999999";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 1.5s ease";

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
  }, 1600);

  setTimeout(() => {
    toast.remove();
  }, 3200);

  setTimeout(() => {
    fly.remove();
  }, 700);
}

function openProfile() {
  const contact = CONTACT;

  app.innerHTML = `
    <div style="
      background:#000;
      color:#fff;
      height:100vh;
      overflow:auto;
      font-family:-apple-system, BlinkMacSystemFont;
    ">

      <!-- HEADER -->
      <div style="
        position:sticky;
        top:0;
        height:52px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:17px;
        font-weight:600;
        background:#000;
        z-index:10;
      ">
        <span onclick="mountChat()" style="
          position:absolute;
          left:14px;
          font-size:28px;
        ">‹</span>

        Dados do contato
      </div>

      <!-- AVATAR -->
      <div style="
        display:flex;
        flex-direction:column;
        align-items:center;
        margin-top:28px;
      ">
        <img src="${ASSETS.avatar}" style="
          width:110px;
          height:110px;
          border-radius:50%;
          object-fit:cover;
        "/>

        <div style="margin-top:16px;font-size:22px;font-weight:600;">
          ${contact.title}
        </div>

        <div style="margin-top:4px;font-size:15px;color:rgba(255,255,255,0.6);">
          @modelo
        </div>
      </div>

     <!-- BOTÕES CORRETOS -->
<div style="
  display:flex;
  justify-content:space-between;
  padding:20px 14px 10px;
  gap:10px;
">

  ${actionBtnSVG(iconCall(), "Ligar")}
  ${actionBtnSVG(iconVideo(), "Vídeo")}
  ${actionBtnSVG(iconPix(), "Pix")}
  ${actionBtnSVG(iconSearch(), "Pesquisar")}

</div>

<!-- CRIAR CONTATO -->
<div style="
  margin:0 12px 12px;
  background:#111;
  border-radius:14px;
  padding:16px;
  color:#25D366;
  font-size:16px;
  font-weight:500;
">
  Criar contato
</div>

      <!-- BLOCO -->
      <div style="margin:0 12px;background:#111;border-radius:14px;overflow:hidden;">
        ${item(iconMedia(),"Mídia, links e docs","8")}
        ${item(iconStorage(),"Gerenciar armazenamento","14,9 MB")}
        ${item(iconSaved(),"Mensagens salvas","Nenhuma")}
      </div>

      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${item(iconBell(),"Notificações")}
        ${item(iconTheme(),"Tema da conversa")}
        ${item(iconDownload(),"Salvar no Fotos","Desativado")}
      </div>

      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${item(iconTimer(),"Mensagens temporárias","24 horas")}
        ${item(iconLock(),"Trancar conversa")}
        ${item(iconShield(),"Privacidade avançada da conversa","Desativada")}
        ${item(iconCrypto(),"Criptografia")}
      </div>

      <!-- GRUPO -->
      <div style="margin:16px 14px 8px;color:rgba(255,255,255,0.6);font-size:13px;">
        1 grupo em comum
      </div>

      <div style="margin:0 12px;background:#111;border-radius:14px;overflow:hidden;">
        ${item(iconPlus(),"Criar grupo com ~Cleitin")}
        ${item(iconGroup(),contact.title)}
      </div>

      <!-- AÇÕES -->
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${action("Adicionar aos favoritos")}
        ${action("Adicionar à lista")}
        ${action("Exportar conversa")}
        ${action("Limpar conversa", true)}
      </div>

      <!-- PERIGO -->
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${danger("Bloquear " + contact.title)}
        ${danger("Denunciar " + contact.title)}
      </div>

      <div style="height:40px;"></div>
    </div>
  `;
}

function actionBtnSVG(icon, label){
  return `
    <div style="
      flex:1;
      height:82px;
      background:#111;
      border-radius:16px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
    ">
      <div style="margin-bottom:8px;">
        ${icon}
      </div>
      <div style="
        color:#25D366;
        font-size:13px;
        font-weight:500;
      ">
        ${label}
      </div>
    </div>
  `;
}

function item(icon,title,value=""){
  return `
    <div style="
      padding:16px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom:1px solid rgba(255,255,255,0.05);
    ">
      <div style="display:flex;align-items:center;gap:12px;">
        ${icon}
        <span>${title}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:rgba(255,255,255,0.5)">${value}</span>
        <span style="opacity:.3;">›</span>
      </div>
    </div>
  `;
}

function action(text,red=false){
  return `<div style="padding:16px;color:${red?"#ff3b30":"#25D366"};">${text}</div>`;
}

function danger(text){
  return `<div style="padding:16px;color:#ff3b30;">${text}</div>`;
}









/* SVG ICONS */

const iconMedia = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const iconStorage = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>`;
const iconSaved = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>`;
const iconBell = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18"/></svg>`;
const iconTheme = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconDownload = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/></svg>`;
const iconTimer = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconLock = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/></svg>`;
const iconShield = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 2l7 4v6c0 5-3.5 8-7 10"/></svg>`;
const iconCrypto = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg>`;
const iconPlus = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>`;
const iconGroup = () => `<svg width="22" height="22" stroke="white" fill="none" stroke-width="1.8"><circle cx="9" cy="10" r="3"/><circle cx="17" cy="12" r="2"/></svg>`;
const iconCall = () => `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.09 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.9.32 1.78.59 2.63a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.45-1.11a2 2 0 0 1 2.11-.45c.85.27 1.73.47 2.63.59A2 2 0 0 1 22 16.92z"/>
</svg>`;

const iconVideo = () => `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="5" width="15" height="14" rx="2"/>
  <polygon points="18,10 22,8 22,16 18,14"/>
</svg>`;

const iconPix = () => `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 2l5 5-5 5-5-5 5-5z"/>
  <path d="M12 12l5 5-5 5-5-5 5-5z"/>
</svg>`;

const iconSearch = () => `
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#25D366" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="11" r="7"/>
  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
</svg>`;

function actionBtn(label) {
  return `
    <div style="
      width:80px;
      height:70px;
      background:#111;
      border-radius:12px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      font-size:14px;
      color:#25D366;
    ">
      ${label}
    </div>
  `;
}

function profileItem(title, value = "") {
  return `
    <div style="
      padding:16px;
      border-bottom:1px solid rgba(255,255,255,.06);
      display:flex;
      justify-content:space-between;
      align-items:center;
    ">
      <span>${title}</span>
      <span style="opacity:.6">${value}</span>
    </div>
  `;
}

function profileAction(text, red = false) {
  return `
    <div style="
      padding:16px;
      color:${red ? "#ff3b30" : "#25D366"};
    ">
      ${text}
    </div>
  `;
}

function profileDanger(text) {
  return `
    <div style="
      padding:16px;
      color:#ff3b30;
    ">
      ${text}
    </div>
  `;
}

function quickReply(el) {
  const input = document.getElementById("storyReplyInput");
  if (input) input.value = el.textContent;
}

function insertEmoji(el) {
  const input = document.getElementById("storyReplyInput");
  if (input) input.value += el.textContent;
}

function sendReaction(emoji) {
  console.log("Reação enviada:", emoji);
  // Aqui você pode adicionar lógica futura para salvar a reação na conversa
  closeStoryReply();
}

function sendStoryReply() {
  const input = document.getElementById("storyReplyInput");
  if (input && input.value.trim()) {
    console.log("Mensagem enviada:", input.value.trim());
  }
  closeStoryReply();
}

async function endCall(wasAnswered) {
  if (state.ring) {
    try {
      state.ring.pause();
    } catch {}
    state.ring = null;
  }

  const call = document.getElementById("callScreen");
  if (call) call.remove();

  if (!state.chatEl) return;

  if (!wasAnswered) {
    await gisaSay("pq vc n me atendeu?");
    await gisaSay("eu só ia te mostrar rapidinho…");
  } else {
    await gisaSay("…caiu.");
    await gisaSay("isso foi só um pedaço.");
  }

  await sleep(rand(650, 1100));
  addMediaGridBubble();
  await sleep(rand(320, 650));
  addAudioBubble();

  await sleep(rand(700, 1200));
  await gisaSay("aqui eu não posso continuar…");
  await gisaSay("isso aqui não é seguro.");
  await gisaSay("eu só mostro pra quem realmente quer.");

  await sleep(rand(450, 900));
  showCheckoutCta();

  saveState();
}

preloadMedia();
loadState();

if (state.flags.entered) {
  mountChat();
  if (!state.flags.startedChat) {
    setTimeout(startScript, 220);
  }
} else {
  mountPremiumIntro();
}

// VisualViewport - Focado em estabilidade
if (window.visualViewport) {
  let lastHeight = window.visualViewport.height;

  window.visualViewport.addEventListener("resize", () => {
    const chat = document.getElementById("chat");

    // só funciona se estiver na tela de chat
    if (!chat) {
      lastHeight = window.visualViewport.height;
      return;
    }

    // se stories aberto, ignora tudo
    if (document.getElementById("storyVideo")?.style.display === "block") {
      lastHeight = window.visualViewport.height;
      return;
    }

    const vh = window.visualViewport.height;
    const diff = lastHeight - vh;
    const isOpening = diff > 80;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isOpening || isUserNearBottom) {
          chat.scrollTop = chat.scrollHeight;
        }
      });
    });

    lastHeight = vh;
  });
}