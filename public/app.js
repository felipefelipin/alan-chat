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
  name: "Alana Lemes",
  username: "AlanaLemes",
  bio: "Aqui você faz o que quiser comigo... 🔥",
  title: "Alana Lemes",
};

const PERSIST_KEY = "gisa_webapp_state_v6";
const CHECKOUT_URL = "/checkout";

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
    state.flags.routing = false;
  }
  if (Array.isArray(data.history)) state.history = data.history;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function escapeHtml(s) {
  return String(s)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
  saveState();
}

function vibrate(ms = 18) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}

// ── FIX #4: showHome aponta para mountChat ────────────────────────────────────
function showHome() { mountChat(); }

// ==================== KEYBOARD UX ====================
function bindKeyboardUX() {
  const input = document.getElementById("input");
  const chat  = document.getElementById("chat");
  if (!input || !chat) return;

  let startY = 0, lastY = 0, totalDelta = 0, direction = null, isKeyboardOpen = false;

  input.addEventListener("focus", () => {
    document.body.classList.add("kb-open");
    isKeyboardOpen = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.chatEl) {
        state.chatEl.style.paddingBottom = "10px";
        void state.chatEl.offsetHeight;
      }
    }));
  });

  input.addEventListener("blur", () => {
    document.body.classList.remove("kb-open");
    isKeyboardOpen = false;
  });

  chat.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY; lastY = startY; totalDelta = 0; direction = null;
  }, { passive: true });

  chat.addEventListener("touchmove", (e) => {
    const currentY = e.touches[0].clientY;
    const delta = currentY - lastY;
    totalDelta += delta;
    if (Math.abs(totalDelta) > 12) direction = totalDelta > 0 ? "down" : "up";
    lastY = currentY;
  }, { passive: true });

  chat.addEventListener("touchend", () => {
    if (!isKeyboardOpen) return;
    if (direction === "up" && Math.abs(totalDelta) > 70) input.blur();
  });
}

// ==================== CLUSTER/HISTORY HELPERS ====================
function getFlowTypes() { return new Set(["msg","video","cta","mediaGrid","audio"]); }

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

// ==================== PREMIUM INTRO ====================
function mountPremiumIntro() {
  const cacheBust = `?v=${Date.now()}`;
  app.innerHTML = `
    <div class="pIntro">
      <div class="pIntroVideoWrap">
        <video id="pIntroVid" playsinline muted preload="auto" src="${ASSETS.privateIntro + cacheBust}"></video>
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
        <div class="pProgress"><div class="pProgBar" id="pProg"></div></div>
        <div class="pCtaWrap" id="pCtaWrap">
          <button id="pEnterChat" class="pBtnPrimary">entrar na conversa</button>
        </div>
      </div>
    </div>
  `;

  const vid      = document.getElementById("pIntroVid");
  const btnAudio = document.getElementById("pEnableAudio");
  const ctaWrap  = document.getElementById("pCtaWrap");
  const btnEnter = document.getElementById("pEnterChat");
  const sub      = document.getElementById("pSub");
  const prog     = document.getElementById("pProg");
  const tEl      = document.getElementById("pT");

  state.introVidEl = vid;
  ctaWrap.classList.remove("show");
  ctaWrap.style.pointerEvents = "none";

  const tryPlayVideo = async () => { try { await vid.play(); return true; } catch { return false; } };

  const tryEnableAudio = async () => {
    if (state.flags.audioEnabled) return true;
    try {
      if (!state.music) state.music = new Audio(ASSETS.privateMusic + `?v=${Date.now()}`);
      state.music.loop = false; state.music.currentTime = 0; state.music.volume = 0;
      await state.music.play();
      state.flags.audioEnabled = true; saveState();
      await fadeVolume(state.music, 0, 0.9, 750);
      if (btnAudio) { btnAudio.textContent = "som ativado ✓"; btnAudio.disabled = true; }
      if (sub) sub.textContent = "pronto… só mais alguns segundos.";
      return true;
    } catch {
      if (sub) sub.textContent = "toque novamente para ativar";
      return false;
    }
  };

  btnAudio.onclick = async () => { await tryPlayVideo(); await tryEnableAudio(); };
  vid.addEventListener("click", async () => { await tryPlayVideo(); await tryEnableAudio(); });
  vid.addEventListener("error", () => { if (sub) sub.textContent = "não consegui carregar o vídeo…"; showCta(); });

  setTimeout(() => { tryPlayVideo(); }, 150);

  const stopAt = 10.0;
  let ended = false;

  const showCta = () => { ctaWrap.classList.add("show"); ctaWrap.style.pointerEvents = "auto"; };

  const endIntro = async () => {
    if (ended) return;
    ended = true;
    try { vid.pause(); } catch {}
    try {
      if (state.music && state.flags.audioEnabled) {
        await fadeVolume(state.music, state.music.volume ?? 0.9, 0, 650);
        state.music.pause(); state.music.currentTime = 0;
      }
    } catch {}
    const overlay = document.getElementById("pOverlay");
    if (overlay) overlay.style.opacity = "0";
    showCta(); vibrate(14);
  };

  const updateTimer = (secLeft) => {
    const s = Math.max(0, Math.ceil(secLeft));
    if (tEl) tEl.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  };

  const tick = setInterval(() => {
    if (!vid) return;
    const p = Math.max(0, Math.min(1, vid.currentTime / stopAt));
    if (prog) prog.style.width = `${Math.floor(p*100)}%`;
    updateTimer(stopAt - vid.currentTime);
    if (vid.currentTime >= stopAt) { clearInterval(tick); endIntro(); }
  }, 90);

  vid.onended = () => { clearInterval(tick); endIntro(); };

  btnEnter.onclick = async () => {
    if (state.flags.entered) return;
    state.flags.entered = true; saveState();
    try { vid.pause(); } catch {}
    try { if (state.music) { state.music.pause(); state.music.currentTime = 0; } } catch {}
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

// ==================== ROUTING OVERLAY ====================
async function runRoutingOverlayV4() {
  if (state.flags.routing) return;
  state.flags.routing = true;

  app.insertAdjacentHTML("beforeend", `
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
  `);

  await sleep(650);
  const st2 = document.getElementById("st2");
  const st3 = document.getElementById("st3");
  if (st2) st2.style.opacity = "1";
  await sleep(950);
  if (st2) st2.innerHTML = `aguarde um instante <span class="dots">…</span>`;
  await sleep(850);
  if (st3) { st3.style.opacity = "1"; st3.innerHTML = `conexão pronta <span class="check">✓</span>`; }
  vibrate(16);
  await sleep(520);
  const overlay = document.getElementById("routeOverlay");
  if (overlay) overlay.classList.add("fadeOut");
  await sleep(320);
  if (overlay) overlay.remove();
  state.flags.routing = false;
}

// ==================== MOUNT CHAT ====================
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

      <div class="topbar" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;">
        <div style="display:flex;align-items:center;flex:1;min-width:0;">
          <button class="navBtn" onclick="mountChat()" style="margin-right:4px;">
            <span class="navChevron"></span>
          </button>

          <div data-story-avatar onclick="showStories()" style="
            width:40px;height:40px;border-radius:50%;background:#000;
            display:flex;align-items:center;justify-content:center;
            margin-right:10px;flex-shrink:0;
            border:2px solid ${window.storyViewed ? "#2c2c2e" : "#25D366"};
            box-sizing:border-box;
          ">
            <div style="width:34px;height:34px;border-radius:50%;overflow:hidden;">
              <img src="${ASSETS.avatar}?v=1" style="width:100%;height:100%;object-fit:cover;" />
            </div>
          </div>

          <div onclick="openProfile()" style="overflow:hidden;">
            <div style="font-size:15px;font-weight:600;color:#fff;line-height:1.2;">${CONTACT.title}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:2px;">online</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:18px;margin-right:4px;">
          <button onclick="startVideoCall()" style="background:none;border:none;padding:0;display:flex;align-items:center;justify-content:center;width:34px;height:34px;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="6" width="13" height="12" rx="3"></rect>
              <path d="M16 10l5-3v10l-5-3z"></path>
            </svg>
          </button>
          <button onclick="startCall()" style="background:none;border:none;padding:0;display:flex;align-items:center;justify-content:center;width:34px;height:34px;">
            <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 16.92v2.5a1.8 1.8 0 0 1-2 1.8 19 19 0 0 1-8.2-2.9 18.7 18.7 0 0 1-5.8-5.8 19 19 0 0 1-2.62-8.52 1.8 1.8 0 0 1 1.8-1.8h2.5a1.8 1.8 0 0 1 1.7 1.5c.12.8.3 1.6.55 2.3a1.8 1.8 0 0 1-.4 1.8L7.9 9.5a15 15 0 0 0 6.6 6.6l1.9-1.4a1.8 1.8 0 0 1 1.8-.4c.7.25 1.5.43 2.3.55A1.8 1.8 0 0 1 22 16.92z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="chatShell">
        <div class="chat" id="chat"></div>
      </div>

      <div class="composer">
        <button class="composerAttach" type="button"><span class="composerPlusMark">+</span></button>
        <div class="composerField">
          <input id="input" autocomplete="off" placeholder="Mensagem" />
        </div>
        <button class="composerGhostBtn" type="button"><span class="iconSticker">😀</span></button>
        <button class="composerMic" id="composerMic" type="button"><span class="iconMic"></span></button>
        <button class="send is-hidden" id="send"><span class="sendArrow"></span></button>
      </div>
    </div>
  `;

  const sendBtn = document.getElementById("send");
  const input   = document.getElementById("input");
  const micBtn  = document.getElementById("composerMic");

  sendBtn.onclick = onSend;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") onSend(); });
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
  let isMutedVC     = false;  // começa NORMAL (não mutado)
  let isSpeakerVC   = true;   // speaker ativo por padrão

  const ringtoneVC = new Audio("/assets/ringtone.mp3");
  ringtoneVC.loop = true;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacing },
      audio: false,
    });
    ringtoneVC.play().catch(() => {});
  } catch {
    console.warn("Permissão de câmera negada");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÍCONES — desenhados pixel a pixel iguais à foto
  // ═══════════════════════════════════════════════════════════════════════════

  // ··· Mais
  const ICO_MORE = `
    <svg width="24" height="8" viewBox="0 0 24 8" fill="rgba(255,255,255,0.9)">
      <circle cx="2"  cy="4" r="2.2"/>
      <circle cx="12" cy="4" r="2.2"/>
      <circle cx="22" cy="4" r="2.2"/>
    </svg>`;

  // 🔊 Speaker ATIVO — cone preenchido + 3 ondas, PRETO (fundo branco)
  const ICO_SPEAKER_ON = `
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <!-- cone do alto-falante -->
      <path d="M6 11.5H9.5L15 7V23L9.5 18.5H6V11.5Z" fill="#111"/>
      <!-- onda pequena -->
      <path d="M18 12.5C18.8 13.3 18.8 16.7 18 17.5"
            stroke="#111" stroke-width="2" stroke-linecap="round" fill="none"/>
      <!-- onda média -->
      <path d="M20.5 10C22.5 12 22.5 18 20.5 20"
            stroke="#111" stroke-width="2" stroke-linecap="round" fill="none"/>
      <!-- onda grande -->
      <path d="M23 7.5C26 10.5 26 19.5 23 22.5"
            stroke="#111" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`;

  // 🔇 Speaker INATIVO (fundo escuro)
  const ICO_SPEAKER_OFF = `
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <path d="M6 11.5H9.5L15 7V23L9.5 18.5H6V11.5Z" fill="rgba(255,255,255,0.85)"/>
      <line x1="19" y1="11" x2="25" y2="19" stroke="rgba(255,255,255,0.85)" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="25" y1="11" x2="19" y2="19" stroke="rgba(255,255,255,0.85)" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;

  // 📷 Câmera — cinza claro sobre cinza médio, IDÊNTICA À FOTO, não clicável
  const ICO_CAM = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <!-- corpo retangular arredondado -->
      <rect x="2" y="9" width="20" height="14" rx="3.5" fill="rgba(210,205,205,0.80)"/>
      <!-- triângulo lateral (lente) -->
      <path d="M22 13.5L29 10V22L22 18.5V13.5Z" fill="rgba(210,205,205,0.80)"/>
    </svg>`;

  // 🎤 Mic NORMAL — preenchido branco, fundo escuro
  const ICO_MIC_ON = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="12" rx="3"
            fill="rgba(255,255,255,0.9)"/>
      <path d="M5 10a7 7 0 0 0 14 0"
            stroke="rgba(255,255,255,0.9)" stroke-width="2"
            stroke-linecap="round" fill="none"/>
      <line x1="12" y1="17" x2="12" y2="21"
            stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round"/>
      <line x1="9"  y1="21" x2="15" y2="21"
            stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

  // 🎤 Mic MUTADO — VERMELHO + riscado diagonal, fundo BRANCO (idêntico à foto)
  const ICO_MIC_MUTED = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <!-- corpo do microfone -->
      <rect x="9" y="2" width="6" height="12" rx="3" fill="#c62828"/>
      <!-- arco -->
      <path d="M5 10a7 7 0 0 0 14 0"
            stroke="#c62828" stroke-width="2" stroke-linecap="round" fill="none"/>
      <!-- haste + base -->
      <line x1="12" y1="17" x2="12" y2="21"
            stroke="#c62828" stroke-width="2" stroke-linecap="round"/>
      <line x1="9"  y1="21" x2="15" y2="21"
            stroke="#c62828" stroke-width="2" stroke-linecap="round"/>
      <!-- linha diagonal riscando -->
      <line x1="4" y1="4" x2="20" y2="20"
            stroke="#c62828" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;

  // 📞 Encerrar — telefone inclinado branco, IDÊNTICO À FOTO
  // (receiver curvado, inclinado ~45°, linha fina em cima)
  const ICO_END = `
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2
               c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20
               c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5
               c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"
            fill="white"/>
    </svg>`;

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER — cria botão
  // ═══════════════════════════════════════════════════════════════════════════
  const mkBtn = (id, bg, icon, clickable = true) => `
    <div id="${id}" style="
      display: flex;
      align-items: center;
      justify-content: center;
      ${clickable ? "cursor:pointer;" : "pointer-events:none;"}
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    ">
      <div id="${id}-bg" style="
        width: 64px;
        height: 64px;
        border-radius: 50%;
        background: ${bg};
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.18s ease, transform 0.12s ease;
      ">
        <div id="${id}-icon" style="
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
        ">
          ${icon}
        </div>
      </div>
    </div>`;

  // ═══════════════════════════════════════════════════════════════════════════
  // HTML DA TELA
  // ═══════════════════════════════════════════════════════════════════════════
  app.innerHTML = `
    <div id="vcScreen" style="
      position: relative;
      height: 100dvh;
      background: #3d2020;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      opacity: 0;
      transform: scale(1.03);
      transition: opacity .22s ease, transform .22s ease;
    ">

      <!-- vídeo (sempre ligado, câmera começa ativa) -->
      <video id="vcVideo" autoplay playsinline muted style="
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      "></video>

      <!-- gradiente topo -->
      <div style="
        position:absolute;top:0;left:0;right:0;height:200px;
        background:linear-gradient(to bottom,rgba(0,0,0,.6),transparent);
        pointer-events:none;z-index:2;
      "></div>

      <!-- nome + status -->
      <div style="position:absolute;top:54px;width:100%;text-align:center;z-index:3;">
        <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">
          ${CONTACT.title}
        </div>
        <div style="margin-top:5px;font-size:15px;color:rgba(255,255,255,.7);">
          Chamando...
        </div>
      </div>

      <!-- botão girar câmera -->
      <div id="vcFlip" style="
        position:absolute;right:18px;top:130px;
        width:48px;height:48px;border-radius:50%;
        background:rgba(70,50,50,.55);
        backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
        display:flex;align-items:center;justify-content:center;
        z-index:10;cursor:pointer;
      ">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,.9)" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"/>
          <path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
          <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
        </svg>
      </div>

      <!-- gradiente baixo -->
      <div style="
        position:absolute;bottom:0;left:0;right:0;height:240px;
        background:linear-gradient(to top,rgba(0,0,0,.7),transparent);
        pointer-events:none;z-index:2;
      "></div>

      <!-- ═══ BARRA DE CONTROLES ═══ -->
      <div style="
        position: absolute;
        bottom: 44px;
        left: 0; right: 0;
        display: flex;
        justify-content: center;
        z-index: 10;
      ">
        <div style="
          background: rgba(60,40,40,0.45);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-radius: 52px;
          padding: 12px 16px;
          display: flex;
          gap: 12px;
          align-items: center;
        ">
          ${mkBtn("vcMore",    "rgba(110,85,85,0.80)", ICO_MORE,       true)}
          ${mkBtn("vcSpeaker", "#ffffff",               ICO_SPEAKER_ON, true)}
          ${mkBtn("vcCam",     "rgba(115,105,105,0.75)", ICO_CAM,       false)}
          ${mkBtn("vcMic",     "rgba(110,85,85,0.80)", ICO_MIC_ON,     true)}
          ${mkBtn("vcEnd",     "#e5252a",               ICO_END,        true)}
        </div>
      </div>

      <!-- overlay encerrado -->
      <div id="vcEndOverlay" style="
        position:fixed;inset:0;background:#000;color:#fff;
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
        opacity:0;pointer-events:none;transition:opacity .35s ease;z-index:999;
      ">
        <div style="font-size:22px;font-weight:600;">${CONTACT.title}</div>
        <div style="font-size:15px;opacity:.6;">Chamada encerrada</div>
      </div>

    </div>
  `;

  // ── conecta vídeo ──────────────────────────────────────────────────────────
  const vcVideo  = document.getElementById("vcVideo");
  const vcScreen = document.getElementById("vcScreen");

  vcVideo.srcObject = stream;
  vcVideo.onloadedmetadata = () => {
    vcVideo.play();
    requestAnimationFrame(() => {
      vcScreen.style.opacity   = "1";
      vcScreen.style.transform = "scale(1)";
    });
  };

  // ── helpers ────────────────────────────────────────────────────────────────
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
    el.style.transform = "scale(0.87)";
    setTimeout(() => { el.style.transform = "scale(1)"; }, 130);
  }

  // ── SPEAKER ───────────────────────────────────────────────────────────────
  document.getElementById("vcSpeaker").onclick = () => {
    pulse("vcSpeaker");
    isSpeakerVC = !isSpeakerVC;
    if (isSpeakerVC) {
      setBg("vcSpeaker", "#ffffff");
      setIcon("vcSpeaker", ICO_SPEAKER_ON);
    } else {
      setBg("vcSpeaker", "rgba(110,85,85,0.80)");
      setIcon("vcSpeaker", ICO_SPEAKER_OFF);
    }
  };

  // ── MIC ── começa NORMAL, só muta ao clicar ───────────────────────────────
  document.getElementById("vcMic").onclick = () => {
    pulse("vcMic");
    isMutedVC = !isMutedVC;
    if (isMutedVC) {
      // MUTADO: fundo branco + ícone vermelho riscado (igual à foto)
      setBg("vcMic", "#ffffff");
      setIcon("vcMic", ICO_MIC_MUTED);
    } else {
      // NORMAL: fundo escuro + ícone branco
      setBg("vcMic", "rgba(110,85,85,0.80)");
      setIcon("vcMic", ICO_MIC_ON);
    }
  };

  // ── MAIS ─────────────────────────────────────────────────────────────────
  document.getElementById("vcMore").onclick = () => { pulse("vcMore"); };

  // ── GIRAR CÂMERA ─────────────────────────────────────────────────────────
  document.getElementById("vcFlip").onclick = async () => {
    if (isSwitching) return;
    isSwitching = true;
    currentFacing = currentFacing === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing },
        audio: false,
      });
      const old = stream;
      vcVideo.srcObject = newStream;
      stream = newStream;
      setTimeout(() => old.getTracks().forEach(t => t.stop()), 120);
    } catch {}
    isSwitching = false;
  };

  // ── ENCERRAR ─────────────────────────────────────────────────────────────
  document.getElementById("vcEnd").onclick = () => {
    ringtoneVC.pause();
    ringtoneVC.currentTime = 0;
    const ol = document.getElementById("vcEndOverlay");
    if (ol) ol.style.opacity = "1";
    vcScreen.style.opacity   = "0";
    vcScreen.style.transform = "scale(.96)";
    setTimeout(() => {
      stream.getTracks().forEach(t => t.stop());
      openProfile();
    }, 380);
  };

  // encerra automaticamente após 40s
  setTimeout(() => {
    ringtoneVC.pause();
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
function scrollBottom(force = false) {
  const el = state.chatEl;
  if (!el) return;
  if (!force && !isUserNearBottom) return;
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function removeTyping() {
  const el = document.getElementById("typingRow");
  if (el) el.remove();
}

function handleScrollDetection() {
  const chat = state.chatEl;
  if (!chat) return;
  chat.addEventListener("scroll", () => {
    const position = chat.scrollTop + chat.clientHeight;
    isUserNearBottom = (chat.scrollHeight - position) <= 80;
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
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
    </div>
  `;
  state.chatEl.appendChild(row);
  scrollBottom();
}

// ==================== RENDER ====================
function pushHistory(item) {
  state.history.push(item);
  if (state.history.length > 260) state.history = state.history.slice(-260);
  saveState();
}

function renderTicks(item) {
  if (item.side !== "right") return "";
  return `<span class="tickWrap" aria-hidden="true"><span class="tick tick1"></span><span class="tick tick2"></span></span>`;
}

function renderMeta(item) {
  return `<div class="meta"><span class="metaTime">${item.time || nowTime()}</span>${renderTicks(item)}</div>`;
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
  return `
    <div class="audioBubbleShell">
      <button class="audioPlayFake" type="button" aria-hidden="true"><span class="audioPlayTriangle"></span></button>
      <div class="audioWaveWrap">
        <div class="audioWave">
          ${bars.map((h, i) => `<span class="waveBar ${i < 6 ? "isPlayed" : ""}" style="height:${h}px"></span>`).join("")}
        </div>
        <div class="audioMetaRow">
          <span class="audioStart">${item.start || "0:09"}</span>
          <span class="audioEnd">${item.end || "10:00"}</span>
        </div>
      </div>
      <button class="audioMicFake" type="button" aria-hidden="true"><span class="audioMicIcon"></span></button>
      <div class="audioAvatarMini avatarImgWrap">
        <img src="${ASSETS.avatar}?v=1" alt="${CONTACT.title}" onerror="this.parentNode.classList.add('avatarFallback')" />
        <span class="avatarFallbackText">${CONTACT.title.charAt(0)}</span>
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
        <div class="bubbleText">${item.html}</div>${renderMeta(item)}
      </div>
    </div>`;

  if (item.type === "video") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-media ${anim}">
        <div class="videoBubble">
          <video playsinline muted preload="auto" ${animated ? "autoplay" : ""} src="${item.src}"></video>
          <div class="videoHint">vídeo</div>
        </div>${renderMeta(item)}
      </div>
    </div>`;

  if (item.type === "mediaGrid") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-grid ${anim}">
        ${renderMediaGrid(item)}${renderMeta(item)}
      </div>
    </div>`;

  if (item.type === "audio") return `
    <div class="msgRow ${sideClass} ${cluster}">
      <div class="bubble ${bubbleBase} bubble-audio ${anim}">
        ${renderAudioBubble(item)}${renderMeta(item)}
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
  if (row) state.chatEl.appendChild(row);
  return row;
}

function restoreHistory() {
  if (!state.chatEl || !Array.isArray(state.history)) return;
  state.chatEl.innerHTML = "";
  for (const item of state.history) renderItem(item, false);
  scrollBottom(true);
}

function addMsg(side, html) {
  updatePreviousGroupForNewMessage(side);
  const item = { type:"msg", side, html, time:nowTime(), cluster:getNewCluster(side) };
  pushHistory(item); renderItem(item, true); scrollBottom();
}

function addVideoBubble(src) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"video", side:"left", src:`${src}?v=${Date.now()}`, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottom();
}

function addMediaGridBubble(items = null) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"mediaGrid", side:"left", items:items||getDefaultGridItems(), time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottom();
}

function addAudioBubble(data = {}) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"audio", side:"left", bars:data.bars||getDefaultWaveBars(), start:data.start||"0:09", end:data.end||"10:00", time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottom();
}

function addCtaCard(html) {
  updatePreviousGroupForNewMessage("left");
  const item = { type:"cta", side:"left", html, time:nowTime(), cluster:getNewCluster("left") };
  pushHistory(item); renderItem(item, true); scrollBottom();
}

function typingDelayFor(text) {
  const len = String(text).length;
  return Math.min(6200, rand(850,1450) + len * rand(28,50) + rand(220,920));
}

async function gisaSay(text, opts = {}) {
  const status = Math.random() < 0.15 ? "gravando áudio…" : "digitando…";
  setStatus(status); addTyping();
  await sleep(opts.delay ?? typingDelayFor(text));
  removeTyping(); await sleep(rand(90,220));
  setStatus(CONTACT.subtitle ?? "");
  addMsg("left", escapeHtml(text).replace(/\n/g,"<br/>"));
  await sleep(rand(320,760));
}

function onSend() {
  const input  = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const micBtn  = document.getElementById("composerMic");
  const text = input.value.trim();
  if (!text) return;
  input.value = ""; sendBtn.classList.add("is-hidden"); micBtn.classList.remove("is-hidden");
  addMsg("right", escapeHtml(text));
  handleUserText(text);
}

// ==================== SCRIPT FLOW ====================
async function startScript() {
  if (state.flags.startedChat) return;
  state.flags.startedChat = true;
  state.step = 0; saveState();
  setStatus("enviando vídeo…");
  await sleep(rand(900,1600));
  addVideoBubble(ASSETS.intro);
  await sleep(rand(700,1200));
  setStatus(CONTACT.subtitle ?? "");
  await gisaSay("tive que te trazer pra cá…");
  await gisaSay("aqui eu consigo fazer tudo com mais privacidade.");
  await sleep(rand(400,800));
  await gisaSay("mas me responde uma coisa rapidinho…");
  await gisaSay("você é mais curioso…\nou vai até o fim?");
  state.step = 1; saveState();
}

async function handleUserText(text) {
  if (state.step === 1) {
    state.step = 2; saveState();
    await gisaSay("hm…"); await gisaSay("foi o que eu imaginei");
    await sleep(rand(700,1200));
    await gisaSay("posso te mostrar rapidinho por chamada?");
    state.step = 3; saveState();
    return;
  }
  if (state.step === 3) {
    state.step = 4; saveState();
    await gisaSay("ok… espera."); await gisaSay("não some.");
    await sleep(rand(900,1500));
    showIncomingCall();
  }
}

function openCheckout() {
  try { if (tg?.openLink) tg.openLink(CHECKOUT_URL); else window.location.href = CHECKOUT_URL; }
  catch { window.location.href = CHECKOUT_URL; }
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
  setTimeout(() => { const btn = document.getElementById("goCheckoutBtn"); if (btn) btn.onclick = openCheckout; }, 0);
}

function showIncomingCall() {
  try {
    state.ring = new Audio(ASSETS.ringtone + `?v=${Date.now()}`);
    state.ring.loop = true;
    state.ring.play().catch(() => {});
  } catch {}

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

  setTimeout(() => {
    const declineBtn = document.getElementById("decline");
    const acceptBtn  = document.getElementById("accept");
    if (declineBtn) declineBtn.onclick = () => endCall(false);
    if (acceptBtn)  acceptBtn.onclick  = () => { endCall(true); startVideoCall(); };
  }, 0);
}

// ==================== STORY VIDEO INIT ====================
(function initStoryVideo() {
  if (document.getElementById("storyVideo")) return;
  const video = document.createElement("video");
  video.id = "storyVideo";
  video.src = "/assets/story-video.mp4";
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
  const el = document.querySelector("[data-story-avatar]");
  if (el) el.classList.add("story-viewed");
  window.storyViewed = true;
}

function exitStories(fromSwipe = false, swipeScreen = null) {
  if (_storyExiting) return;
  _storyExiting = true;

  const video  = document.getElementById("storyVideo");
  const screen = swipeScreen || document.querySelector(".full");

  if (!screen) { _storyExiting = false; return; }

  if (window.storyViewed) markStoryAsViewed();

  const origin = getAvatarOrigin();

  screen.style.transformOrigin = `${origin.x} ${origin.y}`;
  screen.style.transition      = `transform ${STORY_DURATION}ms ${STORY_EASING}, opacity ${STORY_DURATION}ms ${STORY_EASING}`;
  screen.style.transform       = fromSwipe ? "scale(0) translateY(0)" : "scale(0.04)";
  screen.style.opacity         = "0";

  setTimeout(() => {
    video.pause(); video.src = ""; video.style.display = "none";
    video.oncanplay = null; video.onplay = null; video.onpause = null; video.onended = null;
    _storyExiting = false;
    mountChat(); // ← FIX #4: era showHome()
  }, STORY_DURATION + 30);
}

function showStories() {
  console.log("📸 Stories aberto");
  _storyExiting = false; window.storyViewed = false;

  const video = document.getElementById("storyVideo");
  if (!window.__storyHeight) window.__storyHeight = window.innerHeight;
  const realHeight = window.__storyHeight;

  if (!video.src) video.src = "/assets/story-video.mp4";

  Object.assign(video.style, {
    display:"block", position:"fixed", top:"0", left:"0",
    width:"100vw", height:realHeight+"px", objectFit:"cover",
    zIndex:"0", transform:"translateZ(0)", willChange:"transform",
  });
  video.currentTime = 0;

  if (video.readyState >= 2) video.play().catch(() => {});
  else video.oncanplay = () => { video.play().catch(() => {}); };

  const origin = getAvatarOrigin();

  app.innerHTML = `
    <div class="full" style="
      background:transparent;position:relative;overflow:hidden;height:${realHeight}px;
      transform-origin:${origin.x} ${origin.y};transform:scale(0.04);opacity:0;
      will-change:transform,opacity;
    ">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.22);z-index:20;">
        <div id="progressBar" style="height:100%;width:0%;background:#fff;"></div>
      </div>

      <div style="position:absolute;top:8px;left:14px;right:14px;display:flex;align-items:center;z-index:30;">
        <button onclick="exitStories()" style="background:none;border:0;color:#fff;font-size:34px;margin-right:10px;padding:0;line-height:1;cursor:pointer;">‹</button>
        <div style="width:32px;height:32px;margin-right:10px;border-radius:50%;overflow:hidden;flex-shrink:0;">
          <img src="${ASSETS.avatar}?v=1" style="width:100%;height:100%;object-fit:cover;"/>
        </div>
        <div style="margin-top:1px;">
          <div style="color:#fff;font-weight:600;font-size:15px;">${CONTACT.title}</div>
          <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:2px;">12h</div>
        </div>
      </div>

      <div id="replyBar" style="position:absolute;bottom:0;left:0;right:0;padding:12px 16px 20px;background:linear-gradient(to top,rgba(0,0,0,.92),transparent);z-index:40;">
        <div onclick="openStoryReply()" style="background:rgba(255,255,255,.14);border-radius:30px;padding:14px 20px;color:#fff;display:flex;align-items:center;cursor:pointer;">
          <span style="flex:1;">Responder...</span>
        </div>
      </div>
    </div>
  `;

  const screen = document.querySelector(".full");

  requestAnimationFrame(() => requestAnimationFrame(() => {
    screen.style.transition = `transform ${STORY_DURATION}ms ${STORY_EASING}, opacity ${STORY_DURATION}ms ${STORY_EASING}`;
    screen.style.transform  = "scale(1)";
    screen.style.opacity    = "1";
  }));

  const progress = document.getElementById("progressBar");
  let progressInterval = null;

  video.onplay = () => {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!video.duration) return;
      progress.style.width = (video.currentTime / video.duration) * 100 + "%";
    }, 50);
  };
  video.onpause  = () => clearInterval(progressInterval);
  video.onended  = () => { clearInterval(progressInterval); window.storyViewed = true; exitStories(); };

  screen.addEventListener("click", (e) => {
    if (e.target.closest("#replyBar") || e.target.closest("button") || _storyExiting) return;
    window.storyViewed = true; exitStories();
  });

  let startY = 0, startX = 0, currentY = 0, dragging = false, isHolding = false, holdTimer = null, swipeCommitted = false;

  screen.addEventListener("touchstart", (e) => {
    if (_storyExiting) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    currentY = startY; dragging = true; swipeCommitted = false; isHolding = false;
    holdTimer = setTimeout(() => { if (!swipeCommitted) { isHolding = true; video.pause(); } }, 180);
  }, { passive: true });

  screen.addEventListener("touchmove", (e) => {
    if (_storyExiting || !dragging || isHolding) return;
    clearTimeout(holdTimer);
    const touchY = e.touches[0].clientY, touchX = e.touches[0].clientX;
    const diffY = touchY - startY, diffX = Math.abs(touchX - startX);
    if (diffX > diffY || diffY <= 0) return;
    currentY = touchY;
    const prog2  = Math.min(diffY / (realHeight * 0.55), 1);
    const scale  = 1 - prog2 * 0.46;
    const transY = diffY * 0.65;
    const opac   = 1 - prog2 * 0.65;
    screen.style.transition      = "none";
    screen.style.transformOrigin = `${origin.x} ${origin.y}`;
    screen.style.transform       = `translateY(${transY}px) scale(${scale})`;
    screen.style.opacity         = String(Math.max(opac, 0.35));
  }, { passive: true });

  screen.addEventListener("touchend", () => {
    clearTimeout(holdTimer);
    if (isHolding) { isHolding = false; dragging = false; video.play().catch(() => {}); return; }
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
    swipeCommitted = true; window.storyViewed = true;
    exitStories(true, screen);
  });
}

// ==================== STORY REPLY ====================
function openStoryReply() {
  if (document.getElementById("storyReplyOverlay")) return;
  const video  = document.getElementById("storyVideo");
  const oldBar = document.getElementById("replyBar");
  if (video) video.pause();
  if (oldBar) oldBar.style.display = "none";
  document.body.style.overflow = "hidden";

  document.body.insertAdjacentHTML("beforeend", `
    <div id="storyReplyOverlay" style="position:fixed;inset:0;z-index:9999;">
      <div class="story-hint">Toque para enviar</div>
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
      <div class="story-input-bar" id="replyBarKeyboard">
        <span class="plus-btn">＋</span>
        <div class="story-input-wrap">
          <input id="storyReplyInput" type="text" placeholder="" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
        </div>
        <span class="side-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="3.5"/>
          </svg>
        </span>
        <span class="side-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="3" width="6" height="12" rx="3"/>
            <path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4"/>
          </svg>
        </span>
      </div>
    </div>
  `);

  const overlay  = document.getElementById("storyReplyOverlay");
  const input    = document.getElementById("storyReplyInput");
  const replyBar = document.getElementById("replyBarKeyboard");

  replyBar.style.opacity = "1"; replyBar.style.bottom = "10px"; replyBar.style.transform = "translateY(0)";
  input.focus(); input.click();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch {}
  if (window.Telegram?.WebApp) Telegram.WebApp.expand();
  requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.click(); });

  let keyboardOpen = false;
  const handleViewport = () => {
    const vh   = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const kb   = window.innerHeight - vh;
    if (kb > 120 && !keyboardOpen) { keyboardOpen = true; replyBar.style.transition = "none"; replyBar.style.transform = "translateY(-320px)"; }
    if (kb < 80  && keyboardOpen)  { keyboardOpen = false; replyBar.style.transition = "none"; replyBar.style.transform = "translateY(0)"; }
  };
  window.visualViewport?.addEventListener("resize", handleViewport);
  overlay._viewportHandler = handleViewport;
  overlay.addEventListener("click", (e) => { if (e.target.id === "storyReplyOverlay") closeStoryReply(); });
}

function closeStoryReply() {
  const overlay = document.getElementById("storyReplyOverlay");
  if (overlay) {
    if (overlay._viewportHandler && window.visualViewport) window.visualViewport.removeEventListener("resize", overlay._viewportHandler);
    overlay.remove();
  }
  const input = document.getElementById("storyReplyInput");
  if (input) input.blur();
  document.body.style.overflow = "";
  const oldBar = document.getElementById("replyBar");
  if (oldBar) { oldBar.style.display = "block"; oldBar.style.opacity = "1"; oldBar.style.transform = "translateY(0)"; }
  window.scrollTo(0,0);
  setTimeout(() => window.scrollTo(0,0), 30);
  setTimeout(() => window.scrollTo(0,0), 120);
  const video = document.getElementById("storyVideo");
  if (video) {
    Object.assign(video.style, { position:"fixed", top:"0", left:"0", width:"100vw", height:window.__storyHeight+"px", objectFit:"cover", transform:"translateZ(0)", willChange:"transform" });
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
  const contact = CONTACT;
  app.innerHTML = `
    <div style="background:#000;color:#fff;height:100vh;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="position:sticky;top:0;height:52px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;background:#000;z-index:10;">
        <span onclick="mountChat()" style="position:absolute;left:14px;font-size:28px;">‹</span>
        Dados do contato
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;margin-top:24px;">
        <div data-story-avatar onclick="showStories()" style="
          width:110px;height:110px;border-radius:50%;
          border:4px solid ${window.storyViewed ? "rgba(255,255,255,0.25)" : "#25D366"};
          padding:3px;box-sizing:border-box;cursor:pointer;
          transition:border-color 0.4s ease;
        ">
          <img src="${ASSETS.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">
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
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        <div onclick="openMediaScreen()" style="cursor:pointer;">${item(iconMedia(),"Mídia, links e docs")}</div>
        <div onclick="openStorageScreen()">${item(iconStorage(),"Gerenciar armazenamento")}</div>
        <div onclick="openSavedMessages()">${item(iconSaved(),"Mensagens salvas","Nenhuma")}</div>
      </div>
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        <div onclick="openNotificationsScreen()">${item(iconBell(),"Notificações")}</div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconTheme()}<span>Tema da conversa</span></div>
        <div style="display:flex;justify-content:space-between;padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;">${iconDownload()}<span>Salvar no Fotos</span></div>
          <span style="color:rgba(255,255,255,0.5);">Desativado</span>
        </div>
      </div>
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
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
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconPlus()}<span>Criar grupo com ${contact.title}</span></div>
        <div style="display:flex;align-items:center;padding:16px;gap:12px;">${iconGroup()}<span>${contact.title}</span></div>
      </div>
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${action("Adicionar aos favoritos")}${action("Adicionar à lista")}${action("Exportar conversa")}${action("Limpar conversa",true)}
      </div>
      <div style="margin:12px;background:#111;border-radius:14px;overflow:hidden;">
        ${danger("Bloquear "+contact.title)}${danger("Denunciar "+contact.title)}
      </div>
      <div style="height:40px;"></div>
    </div>
  `;
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
      <div style="margin:0 12px;background:#111;border-radius:14px;overflow:hidden;">
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
async function endCall(wasAnswered) {
  if (state.ring) { try { state.ring.pause(); } catch {} state.ring = null; }
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
  await sleep(rand(650,1100));
  addMediaGridBubble();
  await sleep(rand(320,650));
  addAudioBubble();
  await sleep(rand(700,1200));
  await gisaSay("aqui eu não posso continuar…");
  await gisaSay("isso aqui não é seguro.");
  await gisaSay("eu só mostro pra quem realmente quer.");
  await sleep(rand(450,900));
  showCheckoutCta();
  saveState();
}

// ==================== INIT ====================
preloadMedia();
loadState();

if (state.flags.entered) {
  mountChat();
  if (!state.flags.startedChat) setTimeout(startScript, 220);
} else {
  mountPremiumIntro();
}

if (window.visualViewport) {
  let lastHeight = window.visualViewport.height;
  window.visualViewport.addEventListener("resize", () => {
    const chat = document.getElementById("chat");
    if (!chat) { lastHeight = window.visualViewport.height; return; }
    if (document.getElementById("storyVideo")?.style.display === "block") { lastHeight = window.visualViewport.height; return; }
    const vh = window.visualViewport.height;
    const isOpening = (lastHeight - vh) > 80;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (isOpening || isUserNearBottom) chat.scrollTop = chat.scrollHeight;
    }));
    lastHeight = vh;
  });
}