// =======================
// Telegram WebApp bootstrap
// =======================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const app = document.getElementById("app");

// =======================
// Assets
// =======================
const ASSETS = {
  privateIntro: "/assets/private-intro-v1.mp4",
  privateMusic: "/assets/private-music.mp3",
  intro: "/assets/intro.mp4",
  callVideo: "/assets/call.mp4",
  ringtone: "/assets/ringtone.mp3",
  avatar: "/assets/avatar-gisa.jpg",
};

// =======================
// Persistência
// =======================
const PERSIST_KEY = "gisa_webapp_state_v4";
const CHECKOUT_URL = "/checkout";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// =======================
// Estado
// =======================
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

function snapshotForSave() {
  return {
    step: state.step,
    flags: {
      entered: !!state.flags.entered,
      audioEnabled: !!state.flags.audioEnabled,
      routing: false,
      startedChat: !!state.flags.startedChat,
    },
    history: Array.isArray(state.history) ? state.history.slice(-160) : [],
    ui: {
      statusText: document.getElementById("status")?.textContent ?? "online agora",
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

// =======================
// Utils
// =======================
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

async function preloadMedia() {
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
    await sleep(stepMs);
  }
}

// =======================
// Cluster / visual grouping
// =======================
function updatePreviousGroupForNewMessage(side) {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const item = state.history[i];
    if (!item || item.side !== side) break;
    if (item.type !== "msg" && item.type !== "video" && item.type !== "cta") break;

    if (item.cluster === "single") item.cluster = "first";
    else if (item.cluster === "last") item.cluster = "middle";
    else if (item.cluster === "first") item.cluster = "first";
    else if (item.cluster === "middle") item.cluster = "middle";

    break;
  }
}

function getNewCluster(side) {
  const last = state.history[state.history.length - 1];
  if (!last) return "single";
  if (last.side !== side) return "single";
  if (!["msg", "video", "cta"].includes(last.type)) return "single";
  return "last";
}

function rebuildClusters() {
  const flowTypes = new Set(["msg", "video", "cta"]);
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

// =======================
// PREMIUM INTRO
// =======================
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

// =======================
// ROUTING OVERLAY
// =======================
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

// =======================
// CHAT UI
// =======================
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

      <div class="topbar">
        <button class="navBtn" type="button" aria-label="Voltar">
          <span class="navChevron"></span>
        </button>

        <div class="avatarWrap">
          <div class="avatar avatarImgWrap">
            <img
              src="${ASSETS.avatar}?v=1"
              alt="Gisa"
              onerror="this.parentNode.classList.add('avatarFallback')"
            />
            <span class="avatarFallbackText">G</span>
          </div>
        </div>

        <div class="titlebox">
          <div class="name">Gisa</div>
          <div class="status" id="status">online agora</div>
        </div>

        <div class="topActions">
          <button class="iconBtn" type="button" aria-hidden="true">
            <span class="iconDots"></span>
          </button>
        </div>
      </div>

      <div class="chatShell">
        <div class="dayDivider">
          <span>hoje</span>
        </div>
        <div class="chat" id="chat"></div>
      </div>

      <div class="composer">
        <button class="composerPlus" type="button" aria-hidden="true">+</button>

        <div class="composerField">
          <input id="input" autocomplete="off" placeholder=" " />
          <span class="composerPlaceholder">Mensagem</span>
        </div>

        <button class="send" id="send" aria-label="Enviar">
          <span class="sendArrow"></span>
        </button>
      </div>
    </div>
  `;

  document.getElementById("send").onclick = onSend;
  document.getElementById("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSend();
  });

  state.chatEl = document.getElementById("chat");
  restoreHistory();

  setInterval(() => {
    const t = document.getElementById("sbTime");
    if (t) t.textContent = nowTime();
  }, 30000);
}

function scrollBottom(smooth = true) {
  if (!state.chatEl) return;
  const top = state.chatEl.scrollHeight;
  if (smooth && "scrollTo" in state.chatEl) {
    state.chatEl.scrollTo({ top, behavior: "smooth" });
  } else {
    state.chatEl.scrollTop = top;
  }
}

function removeTyping() {
  const el = document.getElementById("typingRow");
  if (el) el.remove();
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
  if (state.history.length > 180) state.history = state.history.slice(-180);
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
  if (row) {
    state.chatEl.appendChild(row);
  }
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
  if (!Array.isArray(state.history) || state.history.length === 0) return;
  rerenderHistory();
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
  rerenderHistory();
}

function addVideoBubble(src, seconds = 10) {
  updatePreviousGroupForNewMessage("left");

  const fullSrc = `${src}?v=${Date.now()}`;

  const item = {
    type: "video",
    side: "left",
    src: fullSrc,
    time: nowTime(),
    cluster: getNewCluster("left"),
  };

  pushHistory(item);
  rerenderHistory();

  const videos = state.chatEl.querySelectorAll("video");
  const vid = videos[videos.length - 1];
  if (!vid) return;

  const stopAt = Number(seconds) > 0 ? Number(seconds) : 10;
  const t = setInterval(() => {
    if (vid.currentTime >= stopAt) {
      try {
        vid.pause();
      } catch {}
      clearInterval(t);
    }
  }, 120);

  vid.onended = () => clearInterval(t);
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
  rerenderHistory();
}

function typingDelayFor(text) {
  const len = String(text).length;
  const base = rand(850, 1450);
  const per = rand(28, 50);
  const jitter = rand(220, 920);
  return Math.min(6200, base + len * per + jitter);
}

async function gisaSay(text, opts = {}) {
  const status =
    Math.random() < 0.15 ? "gravando áudio…" : "digitando…";

  setStatus(status);
  addTyping();

  await sleep(opts.delay ?? typingDelayFor(text));
  removeTyping();

  await sleep(rand(90, 220));
  setStatus("online agora");

  addMsg("left", escapeHtml(text).replace(/\n/g, "<br/>"));
  await sleep(rand(320, 760));
}

function onSend() {
  const input = document.getElementById("input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  addMsg("right", escapeHtml(text));
  handleUserText(text);
}

// =======================
// Funil
// =======================
async function startScript() {
  if (state.flags.startedChat) return;
  state.flags.startedChat = true;

  state.step = 0;
  saveState();

  setStatus("enviando vídeo…");
  await sleep(rand(900, 1600));

  addVideoBubble(ASSETS.intro, 10);

  await sleep(rand(700, 1200));
  setStatus("online agora");

  await gisaSay("tive que te trazer pra cá…");
  await gisaSay("aqui eu consigo fazer tudo com mais privacidade.");
  await sleep(rand(500, 900));
  await gisaSay("mas me responde uma coisa rapidinho…");
  await gisaSay("você é mais curioso…\nou vai até o fim?");

  state.step = 1;
  saveState();
}

async function handleUserText() {
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

// =======================
// Checkout CTA
// =======================
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

// =======================
// CALL
// =======================
function showIncomingCall() {
  try {
    state.ring = new Audio(ASSETS.ringtone + `?v=${Date.now()}`);
    state.ring.loop = true;
    state.ring.play().catch(() => {});
  } catch {}

  app.insertAdjacentHTML(
    "beforeend",
    `
    <div class="callScreen" id="callScreen">
      <div class="callAmbient"></div>

      <div class="callCenter">
        <div class="avatar callAvatar avatarImgWrap">
          <img
            src="${ASSETS.avatar}?v=1"
            alt="Gisa"
            onerror="this.parentNode.classList.add('avatarFallback')"
          />
          <span class="avatarFallbackText">G</span>
        </div>

        <div class="callName">Gisa</div>
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
  `
  );

  document.getElementById("decline").onclick = () => endCall(false);
  document.getElementById("accept").onclick = () => endCall(true);
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

  await sleep(rand(800, 1400));
  await gisaSay("aqui eu não posso continuar…");
  await gisaSay("isso aqui não é seguro.");
  await gisaSay("eu só mostro pra quem realmente quer.");

  await sleep(rand(450, 900));
  showCheckoutCta();

  saveState();
}

// =======================
// init
// =======================
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