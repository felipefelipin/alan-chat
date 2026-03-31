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

function getInputEl() {
  return document.getElementById("input");
}

function bindKeyboardUX() {
  const input = document.getElementById("input");
  const chat = document.getElementById("chat");
  if (!input || !chat) return;

  let lastY = 0;
  let direction = null;

  input.addEventListener("focus", () => {
    document.body.classList.add("kb-open");
    isKeyboardOpen = true;
  });

  input.addEventListener("blur", () => {
    document.body.classList.remove("kb-open");
    isKeyboardOpen = false;
  });

  chat.addEventListener("touchstart", (e) => {
    lastY = e.touches[0].clientY;
  }, { passive: true });

  chat.addEventListener("touchmove", (e) => {
    const currentY = e.touches[0].clientY;
    const delta = currentY - lastY;

    if (Math.abs(delta) > 6) {
      direction = delta > 0 ? "down" : "up";
    }

    lastY = currentY;
  }, { passive: true });

  chat.addEventListener("touchend", () => {
    if (!isKeyboardOpen) return;

    if (direction === "up") {
      input.blur();
    }

    direction = null;
  });
}

function fixViewportHeight() {
  const vh = window.visualViewport
    ? window.visualViewport.height
    : window.innerHeight;

  document.documentElement.style.setProperty('--vvh', `${vh}px`);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', fixViewportHeight);
} else {
  window.addEventListener('resize', fixViewportHeight);
}

fixViewportHeight();

if (window.visualViewport) {
  let lastHeight = window.visualViewport.height;

  window.visualViewport.addEventListener("resize", () => {
    const vh = window.visualViewport.height;

    // ✅ sempre atualiza viewport
    document.documentElement.style.setProperty('--vvh', `${vh}px`);

    const keyboardChanged = Math.abs(vh - lastHeight) > 80;

    if (keyboardChanged) {
      keyboardTransitioning = true;

      // 🔥 trava interação sem quebrar layout
      if (state.chatEl) {
        state.chatEl.style.pointerEvents = "none";
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollBottom(true);

          setTimeout(() => {
            if (state.chatEl) {
              state.chatEl.style.pointerEvents = "auto";
            }
            keyboardTransitioning = false;
          }, 100);
        });
      });
    }

    lastHeight = vh;
  });
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

      <div class="topbar">
        <button class="navBtn" type="button" aria-label="Voltar">
          <span class="navChevron"></span>
        </button>

        <div class="topbarCount">48</div>

        <div class="avatarWrap">
          <div class="avatar avatarImgWrap">
            <img
              src="${ASSETS.avatar}?v=1"
              alt="${CONTACT.title}"
              onerror="this.parentNode.classList.add('avatarFallback')"
            />
            <span class="avatarFallbackText">${CONTACT.title.charAt(0)}</span>
          </div>
        </div>

        <div class="titlebox">
          <div class="name">${CONTACT.number}</div>
          <div class="status" id="status">${CONTACT.subtitle}</div>
        </div>

        <div class="topActions">
          <button class="iconBtn" type="button" aria-hidden="true">
            <span class="topIcon topIconVideo"></span>
          </button>
          <button class="iconBtn" type="button" aria-hidden="true">
            <span class="topIcon topIconPhone"></span>
          </button>
        </div>
      </div>

      <div class="chatShell">
        <div class="chat" id="chat"></div>
      </div>

      <div class="composer composerRef">
        <button class="composerAttach" type="button" aria-hidden="true">
          <span class="composerPlusMark"></span>
        </button>

        <div class="composerField composerFieldRef">
          <input id="input" autocomplete="off" placeholder="Mensagem" />
          <button class="composerGhostBtn" type="button" aria-hidden="true">
            <span class="iconSticker"></span>
          </button>
          <button class="composerGhostBtn" type="button" aria-hidden="true">
            <span class="iconCamera"></span>
          </button>
        </div>

        <button class="composerMic" id="composerMic" type="button" aria-hidden="true">
          <span class="iconMic"></span>
        </button>

        <button class="send is-hidden" id="send" aria-label="Enviar">
          <span class="sendArrow"></span>
        </button>
      </div>
    </div>
  `;

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
  if (!state.chatEl) return;
  if (keyboardTransitioning) return;
  if (!force && !isUserNearBottom) return;

  requestAnimationFrame(() => {
    state.chatEl.scrollTop = state.chatEl.scrollHeight;
  });
}

function removeTyping() {
  const el = document.getElementById("typingRow");
  if (el) el.remove();
}

let isUserNearBottom = true;
let isKeyboardOpen = false;
let keyboardTransitioning = false;

function handleScrollDetection() {
  const chat = state.chatEl;
  if (!chat) return;

  chat.addEventListener("scroll", () => {
    const threshold = 80;

    const position = chat.scrollTop + chat.clientHeight;
    const height = chat.scrollHeight;

    isUserNearBottom = (height - position) < threshold;

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
  if (!Array.isArray(state.history) || state.history.length === 0) return;
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
  scrollBottom(true);
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

  app.insertAdjacentHTML(
    "beforeend",
    `
    <div class="callScreen" id="callScreen">
      <div class="callAmbient"></div>

      <div class="callCenter">
        <div class="avatar callAvatar avatarImgWrap">
          <img
            src="${ASSETS.avatar}?v=1"
            alt="${CONTACT.title}"
            onerror="this.parentNode.classList.add('avatarFallback')"
          />
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