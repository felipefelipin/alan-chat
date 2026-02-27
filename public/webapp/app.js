const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const app = document.getElementById("app");

// ✅ build id para cache-bust consistente nessa sessão
const BUILD_ID = String(Date.now());

const ASSETS = {
  // ✅ Vercel static: /public/assets -> /assets
  privateIntro: "/assets/private-intro-v1.mp4",
  privateMusic: "/assets/private-music.mp3",
  intro: "/assets/intro.mp4",
  callVideo: "/assets/call.mp4",
  ringtone: "/assets/ringtone.mp3",
};

const state = {
  step: 0,
  ring: null,
  chatEl: null,
  music: null,
  introVidEl: null,
  flags: {
    entered: false,
    audioEnabled: false,
    routing: false,
    startedChat: false,
  },
};

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
}

async function preloadMedia() {
  // Preload best-effort (não bloqueia)
  try {
    const v = document.createElement("video");
    v.src = `${ASSETS.privateIntro}?v=${BUILD_ID}`;
    v.preload = "auto";
  } catch {}
  try {
    const a = new Audio();
    a.src = `${ASSETS.privateMusic}?v=${BUILD_ID}`;
    a.preload = "auto";
  } catch {}
}

async function fadeVolume(audio, from, to, ms = 600) {
  if (!audio) return;
  const steps = Math.max(8, Math.floor(ms / 60));
  const stepMs = Math.floor(ms / steps);
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * p));
    await sleep(stepMs);
  }
}

// =======================
// PREMIUM INTRO (V3) - FIX (Vercel + Telegram)
// =======================
function mountPremiumIntro() {
  app.innerHTML = `
    <div class="pIntro">
      <div class="pIntroVideoWrap">
        <video
          id="pIntroVid"
          playsinline
          muted
          preload="auto"
          src="${ASSETS.privateIntro}?v=${BUILD_ID}">
        </video>

        <div class="pIntroOverlay" id="pOverlay">
          <div class="pIntroBadge">conversa privada</div>
          <div class="pIntroTitle">acesso exclusivo</div>
          <div class="pIntroSub" id="pSub">toque para ativar o som</div>

          <div class="pRow">
            <button id="pEnableAudio" class="pBtnGhost">ativar som</button>
          </div>
        </div>

        <div class="pCtaWrap" id="pCtaWrap" style="display:none;">
          <button id="pEnterChat" class="pBtnPrimary">entrar em conversa com gisa</button>
        </div>
      </div>
    </div>
  `;

  const vid = document.getElementById("pIntroVid");
  const btnAudio = document.getElementById("pEnableAudio");
  const ctaWrap = document.getElementById("pCtaWrap");
  const btnEnter = document.getElementById("pEnterChat");
  const sub = document.getElementById("pSub");

  state.introVidEl = vid;

  // 🔥 play mais confiável: tenta no canplay + fallback
  const tryPlayVid = async () => {
    try {
      const p = vid.play();
      if (p && typeof p.then === "function") await p;
      return true;
    } catch (e) {
      return false;
    }
  };

  vid.addEventListener("canplay", () => {
    // tenta iniciar assim que tiver buffer
    tryPlayVid();
  });

  // fallback (autoplay costuma falhar no Telegram)
  setTimeout(() => {
    tryPlayVid();
  }, 140);

  const tryEnableAudio = async () => {
    if (state.flags.audioEnabled) return true;
    try {
      if (!state.music) state.music = new Audio(`${ASSETS.privateMusic}?v=${BUILD_ID}`);
      state.music.loop = false;
      state.music.currentTime = 0;
      state.music.volume = 0;
      await state.music.play();
      state.flags.audioEnabled = true;
      await fadeVolume(state.music, 0, 0.9, 550);

      if (btnAudio) {
        btnAudio.textContent = "som ativado ✓";
        btnAudio.disabled = true;
        btnAudio.style.opacity = "0.65";
      }
      if (sub) sub.textContent = "som ativado";
      return true;
    } catch {
      return false;
    }
  };

  btnAudio.onclick = async () => {
    await tryPlayVid();
    const ok = await tryEnableAudio();
    if (!ok && sub) sub.textContent = "toque novamente para ativar";
  };

  vid.addEventListener("click", async () => {
    await tryPlayVid();
    await tryEnableAudio();
  });

  const stopAt = 10.0;
  let ended = false;

  const endIntro = async () => {
    if (ended) return;
    ended = true;

    try {
      vid.pause();
    } catch {}

    try {
      if (state.music && state.flags.audioEnabled) {
        await fadeVolume(state.music, state.music.volume ?? 0.9, 0, 520);
        state.music.pause();
        state.music.currentTime = 0;
      }
    } catch {}

    if (ctaWrap) ctaWrap.style.display = "flex";

    const overlay = document.getElementById("pOverlay");
    if (overlay) overlay.style.opacity = "0";
  };

  const tick = setInterval(() => {
    if (!vid) return;
    if (vid.currentTime >= stopAt) {
      clearInterval(tick);
      endIntro();
    }
  }, 120);

  vid.onended = () => {
    clearInterval(tick);
    endIntro();
  };

  btnEnter.onclick = async () => {
    if (state.flags.entered) return;
    state.flags.entered = true;

    try {
      vid.pause();
    } catch {}
    try {
      if (state.music) {
        state.music.pause();
        state.music.currentTime = 0;
      }
    } catch {}

    await runRoutingOverlayV3();
    mountChat();
    await sleep(220);
    startScript();
  };

  // fallback leve: se não carregar por algum motivo, libera CTA
  setTimeout(() => {
    if (!ended && (!vid || vid.readyState < 2)) {
      if (ctaWrap) ctaWrap.style.display = "flex";
    }
  }, 2500);
}

async function runRoutingOverlayV3() {
  if (state.flags.routing) return;
  state.flags.routing = true;

  app.insertAdjacentHTML(
    "beforeend",
    `
    <div class="routeOverlay" id="routeOverlay">
      <div class="routeBox">
        <div class="routeTitle">encaminhando para conversa em tempo real</div>
        <div class="routeLoader"></div>
        <div class="routeSteps">
          <div class="routeStep" id="st1">iniciando conexão…</div>
          <div class="routeStep" id="st2" style="opacity:.45;">você está na fila</div>
          <div class="routeStep" id="st3" style="opacity:.45;">pronto</div>
        </div>
      </div>
    </div>
  `
  );

  await sleep(700);
  const st1 = document.getElementById("st1");
  const st2 = document.getElementById("st2");
  const st3 = document.getElementById("st3");

  if (st1) st1.textContent = "verificando conexão…";
  if (st2) st2.style.opacity = "1";

  await sleep(1100);
  if (st2) st2.innerHTML = `você está na fila <span class="dots">…</span>`;

  await sleep(800);
  if (st3) {
    st3.style.opacity = "1";
    st3.innerHTML = `pronto <span class="check">✓</span>`;
  }

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
        <div class="avatar">G</div>
        <div class="titlebox">
          <div class="name">Gisa</div>
          <div class="status" id="status">online</div>
        </div>
      </div>

      <div class="chat" id="chat"></div>

      <div class="composer">
        <input id="input" placeholder="Mensagem..." autocomplete="off" />
        <button class="send" id="send">Enviar</button>
      </div>

    </div>
  `;

  document.getElementById("send").onclick = onSend;
  document.getElementById("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSend();
  });

  state.chatEl = document.getElementById("chat");

  setInterval(() => {
    const t = document.getElementById("sbTime");
    if (t) t.textContent = nowTime();
  }, 30000);
}

function scrollBottom() {
  if (!state.chatEl) return;
  state.chatEl.scrollTop = state.chatEl.scrollHeight;
}

function addTyping() {
  if (!state.chatEl) return;
  removeTyping();
  const row = document.createElement("div");
  row.className = "row left";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="typing">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
    </div>
  `;
  state.chatEl.appendChild(row);
  scrollBottom();
}

function removeTyping() {
  const el = document.getElementById("typingRow");
  if (el) el.remove();
}

function addMsg(side, html) {
  if (!state.chatEl) return;
  const row = document.createElement("div");
  row.className = `row ${side}`;
  row.innerHTML = `
    <div class="bubble">
      ${html}
      <div class="meta">${nowTime()}</div>
    </div>
  `;
  state.chatEl.appendChild(row);
  scrollBottom();
}

function typingDelayFor(text) {
  const len = String(text).length;
  const base = rand(800, 1400);
  const per = rand(32, 54);
  const jitter = rand(260, 1200);
  return Math.min(6800, base + len * per + jitter);
}

async function gisaSay(text, opts = {}) {
  setStatus("digitando…");
  addTyping();
  await sleep(opts.delay ?? typingDelayFor(text));
  removeTyping();
  setStatus("online");
  addMsg("left", escapeHtml(text).replace(/\n/g, "<br/>"));
  await sleep(rand(420, 980));
}

// --- Video bubble inside chat (respeita X segundos)
function addVideoBubble(src, seconds = 10) {
  if (!state.chatEl) return;

  const row = document.createElement("div");
  row.className = "row left";
  row.innerHTML = `
    <div class="bubble">
      <div class="videoBubble">
        <video playsinline muted autoplay preload="auto" src="${src}?v=${BUILD_ID}"></video>
        <div class="videoHint">vídeo</div>
      </div>
      <div class="meta">${nowTime()}</div>
    </div>
  `;
  state.chatEl.appendChild(row);
  scrollBottom();

  const vid = row.querySelector("video");
  if (!vid) return;

  const stopAt = Number(seconds) > 0 ? Number(seconds) : 10;
  let cleared = false;

  const clear = () => {
    if (cleared) return;
    cleared = true;
    try { clearInterval(t); } catch {}
  };

  const t = setInterval(() => {
    if (vid.currentTime >= stopAt) {
      try { vid.pause(); } catch {}
      clear();
    }
  }, 120);

  vid.onended = () => clear();
  vid.onpause = () => {
    if (vid.currentTime >= stopAt - 0.05) clear();
  };
}

// --- User send
function onSend() {
  const input = document.getElementById("input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  addMsg("right", escapeHtml(text));
  handleUserText(text);
}

// =======================
// SCRIPT (seu fluxo atual)
// =======================
async function startScript() {
  if (state.flags.startedChat) return;
  state.flags.startedChat = true;

  state.step = 0;

  setStatus("enviando vídeo…");
  await sleep(rand(900, 1600));

  addVideoBubble(ASSETS.intro, 10);

  await sleep(rand(700, 1200));
  setStatus("online");

  await gisaSay("tive que te trazer pra cá…");
  await gisaSay("aqui eu consigo fazer tudinho no oculto com vc…");

  await sleep(rand(500, 900));
  await gisaSay("mas me responde uma coisa rápido…");
  await gisaSay("você é mais curioso…\nou vai até o fim?");

  state.step = 1;
}

async function handleUserText(text) {
  if (state.step === 1) {
    state.step = 2;

    await gisaSay("hm…");
    await gisaSay("foi o que eu imaginei");

    await sleep(rand(700, 1200));
    await gisaSay("posso te mostrar rapidinho por chamada?");
    state.step = 3;
    return;
  }

  if (state.step === 3) {
    state.step = 4;

    await gisaSay("ok… espera.");
    await gisaSay("não some.");

    await sleep(rand(900, 1500));
    showIncomingCall();
    return;
  }
}

// =======================
// CALL (simplificada)
// =======================
function showIncomingCall() {
  try {
    state.ring = new Audio(`${ASSETS.ringtone}?v=${BUILD_ID}`);
    state.ring.loop = true;
    state.ring.play().catch(() => {});
  } catch {}

  app.insertAdjacentHTML(
    "beforeend",
    `
    <div class="callScreen" id="callScreen">
      <div class="callHeader">
        <div class="avatar">G</div>
        <div>
          <div class="callName">Gisa</div>
          <div class="callSub">chamada de vídeo…</div>
        </div>
      </div>
      <div class="callActions">
        <button class="btnRed" id="decline">Recusar</button>
        <button class="btnGreen" id="accept">Atender</button>
      </div>
    </div>
  `
  );

  document.getElementById("decline").onclick = () => endCall(false);
  document.getElementById("accept").onclick = () => endCall(true);
}

async function endCall(wasAnswered) {
  if (state.ring) {
    state.ring.pause();
    state.ring = null;
  }

  const call = document.getElementById("callScreen");
  if (call) call.remove();

  if (!state.chatEl) return;

  if (!wasAnswered) {
    await gisaSay("pq vc n me atendeu baby?");
    await gisaSay("eu só ia te mostrar rapidinho…");
  } else {
    await gisaSay("…caiu.");
    await gisaSay("isso foi só um pedaço.");
  }

  await sleep(rand(800, 1400));
  await gisaSay("aqui eu não posso continuar…");
  await gisaSay("isso aqui não é seguro.");
  await gisaSay("eu só mostro pra quem realmente quer.");
}

// init
preloadMedia();
mountPremiumIntro();