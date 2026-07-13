// components/reelsViewer.js
// Player de Reels em tela cheia — abre com FLIP a partir da miniatura tocada,
// pager vertical entre vídeos (drag-follow + snap, um vídeo por tela),
// pré-carrega vizinhos, controles somem sozinhos, volta preserva o scroll do grid.
//
// Componentes (cada função cuida de uma coisa só):
//   ReelPlayer            -> mountReelPlayer      (vídeo + spinner + fade-in)
//   ReelProgress           -> mountReelProgress    (barra fina sincronizada)
//   ReelActions             -> mountReelActions     (curtir/comentar/compartilhar/salvar)
//   ReelDescription         -> mountReelDescription (avatar/nome/legenda/áudio)
//   ReelOverlay              -> createReelSlide      (junta tudo + toggle de controles)
//   ReelGestureController     -> attachVerticalPager  (swipe vertical, snap, tap)
//   ReelPreloader             -> updatePreload        (preload dos vizinhos)
//   ReelsViewer                -> openReelsViewer      (orquestra tudo)

import { el, formatCount } from "../utils/dom.js";
import { openCommentsSheet } from "./postViewer.js";

const BACK_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const SOUND_ON_SVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>`;
const SOUND_OFF_SVG = `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 5V4L8 9H4z"/><line x1="16" y1="9" x2="21" y2="14"/><line x1="21" y1="9" x2="16" y2="14"/></svg>`;
const HEART_OUTLINE = `<svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4.5c2.1 0 3.6 1.2 6 3.7 2.4-2.5 3.9-3.7 6-3.7 3.7 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
const HEART_FILLED = `<svg width="27" height="27" viewBox="0 0 24 24" fill="#ff3040"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4.5c2.1 0 3.6 1.2 6 3.7 2.4-2.5 3.9-3.7 6-3.7 3.7 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
const COMMENT_SVG = `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-4-1L3 20l1.2-4A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 20 8.5"/></svg>`;
const SHARE_SVG = `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;
const SAVE_OUTLINE = `<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>`;
const SAVE_FILLED = `<svg width="23" height="23" viewBox="0 0 24 24" fill="#fff"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>`;
const PLAY_CENTER_SVG = `<svg width="34" height="34" viewBox="0 0 24 24" fill="rgba(255,255,255,.9)"><path d="M8 5v14l11-7z"/></svg>`;
const MUSIC_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const VERIFIED_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#3897f0"/><path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const SWIPE_THRESHOLD = 70;

// ── ReelPlayer ───────────────────────────────────────────────────────────────
function mountReelPlayer(reel) {
  const wrap = el("div", { class: "reel-playerWrap" });
  const spinner = el("div", { class: "reel-spinner" });
  const video = el("video", {
    class: "reel-video",
    src: reel.src,
    playsinline: "",
    "webkit-playsinline": "",
    loop: "",
    muted: "",
    preload: "none",
  });
  video.addEventListener("loadeddata", () => {
    video.classList.add("reel-video-ready");
    spinner.classList.add("reel-spinner-hidden");
  }, { once: true });

  wrap.appendChild(video);
  wrap.appendChild(spinner);
  return { wrap, video, spinner };
}

// ── ReelProgress ─────────────────────────────────────────────────────────────
function mountReelProgress() {
  const fill = el("div", { class: "reel-progressFill" });
  const bar = el("div", { class: "reel-progress" }, [fill]);
  return { bar, setProgress: (p) => { fill.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`; } };
}

// ── ReelActions ──────────────────────────────────────────────────────────────
function mountReelActions(reel, profile) {
  const state = { liked: false, saved: false, likeCount: reel.likes ?? 0 };

  const likeBtn = el("button", { class: "reel-actionBtn", type: "button" }, [
    el("span", { class: "reel-actionIcon", html: HEART_OUTLINE }),
    el("span", { class: "reel-actionCount" }, formatCount(state.likeCount)),
  ]);
  const commentBtn = el("button", { class: "reel-actionBtn", type: "button" }, [
    el("span", { class: "reel-actionIcon", html: COMMENT_SVG }),
    el("span", { class: "reel-actionCount" }, formatCount(reel.comments?.length ?? 0)),
  ]);
  const shareBtn = el("button", { class: "reel-actionBtn", type: "button" }, [
    el("span", { class: "reel-actionIcon", html: SHARE_SVG }),
    el("span", { class: "reel-actionCount" }, "Enviar"),
  ]);
  const saveBtn = el("button", { class: "reel-actionBtn", type: "button" }, [
    el("span", { class: "reel-actionIcon", html: SAVE_OUTLINE }),
  ]);

  function refreshLike() {
    likeBtn.querySelector(".reel-actionIcon").innerHTML = state.liked ? HEART_FILLED : HEART_OUTLINE;
    likeBtn.querySelector(".reel-actionCount").textContent = formatCount(state.likeCount);
  }
  likeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.liked = !state.liked;
    state.likeCount += state.liked ? 1 : -1;
    refreshLike();
  });
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.saved = !state.saved;
    saveBtn.querySelector(".reel-actionIcon").innerHTML = state.saved ? SAVE_FILLED : SAVE_OUTLINE;
  });
  commentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCommentsSheet(profile.name, reel.comments ?? [], () => {
      const countEl = commentBtn.querySelector(".reel-actionCount");
      countEl.textContent = formatCount(Number(reel.comments?.length ?? 0) + 1);
    });
  });
  shareBtn.addEventListener("click", (e) => e.stopPropagation());

  const col = el("div", { class: "reel-actions" }, [likeBtn, commentBtn, shareBtn, saveBtn]);
  return col;
}

// ── ReelDescription ──────────────────────────────────────────────────────────
function mountReelDescription(reel, profile) {
  return el("div", { class: "reel-info" }, [
    el("div", { class: "reel-info-user" }, [
      el("img", { class: "reel-info-avatar", src: profile.avatar, alt: "" }),
      el("span", { class: "reel-info-name" }, profile.username),
      profile.verified ? el("span", { class: "reel-info-verified", html: VERIFIED_SVG }) : null,
      el("button", { class: "reel-followBtn", type: "button", onClick: (e) => e.stopPropagation() }, "Seguir"),
    ]),
    el("div", { class: "reel-info-caption" }, reel.caption ?? ""),
    el("div", { class: "reel-info-audio" }, [
      el("span", { html: MUSIC_SVG }),
      el("span", { class: "reel-info-audio-text" }, `Áudio original · ${profile.username}`),
    ]),
  ]);
}

// ── ReelOverlay (junta o slide inteiro) ───────────────────────────────────────
function createReelSlide(reel, profile) {
  const player = mountReelPlayer(reel);
  const progress = mountReelProgress();
  const actions = mountReelActions(reel, profile);
  const info = mountReelDescription(reel, profile);
  const centerPlay = el("div", { class: "reel-centerPlay", html: PLAY_CENTER_SVG });

  // info à esquerda, ações à direita — nessa ordem no DOM (flex row)
  const chrome = el("div", { class: "reel-chrome" }, [info, actions]);

  const slide = el("div", { class: "reel-slide" }, [
    player.wrap,
    centerPlay,
    chrome,
    progress.bar,
  ]);

  return { slide, video: player.video, setProgress: progress.setProgress, centerPlay };
}

// ── ReelsViewer ────────────────────────────────────────────────────────────────
export function openReelsViewer(reels, startIndex, sourceRect, { profile, onClose } = {}) {
  let index = startIndex;
  let destroyed = false;
  let muted = true;
  let rafId = null;

  const backdrop = el("div", { class: "reel-backdrop" });
  const overlay = el("div", { class: "reel-overlay" });
  const topBar = el("div", { class: "reel-topbar" }, [
    el("button", { class: "reel-backBtn", type: "button", html: BACK_SVG, onClick: (e) => { e.stopPropagation(); close(); } }),
    el("span", { class: "reel-topbarLabel" }, "Reels"),
    el("button", { class: "reel-soundBtn", type: "button", html: SOUND_OFF_SVG, onClick: (e) => { e.stopPropagation(); toggleMute(); } }),
  ]);
  const soundBtn = topBar.querySelector(".reel-soundBtn");

  const slides = reels.map((reel) => createReelSlide(reel, profile));
  const pager = el("div", { class: "reel-pager" }, slides.map((s) => s.slide));

  overlay.appendChild(pager);
  overlay.appendChild(topBar);

  const root = el("div", { class: "reel-root" }, [backdrop, overlay]);
  document.body.appendChild(root);

  // FLIP: a caixa já nasce em tela cheia — o transform inicial só faz ela
  // *parecer* do tamanho/posição da miniatura tocada.
  if (sourceRect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const scaleX = sourceRect.width / vw;
    const scaleY = sourceRect.height / vh;
    const dx = (sourceRect.left + sourceRect.width / 2) - vw / 2;
    const dy = (sourceRect.top + sourceRect.height / 2) - vh / 2;
    overlay.style.transition = "none";
    overlay.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
    overlay.style.opacity = "0.4";
    void overlay.offsetWidth;
  }

  requestAnimationFrame(() => {
    backdrop.classList.add("reel-backdrop-in");
    overlay.style.transition = "transform .3s cubic-bezier(.22,.61,.36,1), opacity .3s ease";
    overlay.style.transform = "translate(0,0) scale(1,1)";
    overlay.style.opacity = "1";
  });

  function setPagerPosition(withTransition) {
    pager.style.transition = withTransition ? "transform .3s cubic-bezier(.22,.61,.36,1)" : "none";
    pager.style.transform = `translateY(${-index * 100}%)`;
  }
  setPagerPosition(false);

  // ── ReelPreloader — só os vizinhos ganham preload=auto ──────────────────────
  function updatePreload() {
    slides.forEach((s, i) => {
      const dist = Math.abs(i - index);
      s.video.preload = dist <= 1 ? "auto" : "none";
      if (dist > 1 && !s.video.paused) s.video.pause();
    });
  }

  function toggleMute() {
    muted = !muted;
    slides.forEach((s) => { s.video.muted = muted; });
    soundBtn.innerHTML = muted ? SOUND_OFF_SVG : SOUND_ON_SVG; // ícone reflete o estado atual
  }

  function playActive() {
    slides.forEach((s, i) => {
      if (i === index) {
        s.video.muted = muted;
        s.video.play().catch(() => {});
      } else if (!s.video.paused) {
        s.video.pause();
      }
    });
  }

  // barra de progresso do slide ativo, via rAF (contínua, sem travar)
  function progressLoop() {
    if (destroyed) return;
    const active = slides[index];
    if (active?.video.duration) {
      active.setProgress(active.video.currentTime / active.video.duration);
    }
    rafId = requestAnimationFrame(progressLoop);
  }
  rafId = requestAnimationFrame(progressLoop);

  function goTo(newIndex) {
    index = Math.max(0, Math.min(slides.length - 1, newIndex));
    setPagerPosition(true);
    updatePreload();
    playActive();
  }

  // ── ReelGestureController — swipe vertical (snap) + tap (play/pause + controles) ──
  let startY = 0, dy = 0, dragging = false;

  pager.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startY = t.clientY; dy = 0; dragging = true;
  }, { passive: true });

  pager.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    dy = t.clientY - startY;
    pager.style.transition = "none";
    pager.style.transform = `translateY(calc(${-index * 100}% + ${dy}px))`;
  }, { passive: true });

  pager.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dy) > SWIPE_THRESHOLD) goTo(index + (dy < 0 ? 1 : -1));
    else goTo(index);
  });

  // toque alterna só play/pause — info do perfil e ações nunca somem sozinhas
  pager.addEventListener("click", (e) => {
    if (e.target.closest(".reel-actionBtn") || e.target.closest(".reel-topbar") || e.target.closest(".reel-followBtn")) return;
    const active = slides[index];
    if (active.video.paused) {
      active.video.play().catch(() => {});
      active.centerPlay.classList.remove("reel-centerPlay-show");
    } else {
      active.video.pause();
      active.centerPlay.classList.add("reel-centerPlay-show");
    }
  });

  updatePreload();
  playActive();

  function close() {
    if (destroyed) return;
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    slides.forEach((s) => s.video.pause());

    backdrop.classList.remove("reel-backdrop-in");
    if (sourceRect) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const scaleX = sourceRect.width / vw;
      const scaleY = sourceRect.height / vh;
      const dx = (sourceRect.left + sourceRect.width / 2) - vw / 2;
      const dy2 = (sourceRect.top + sourceRect.height / 2) - vh / 2;
      overlay.style.transform = `translate(${dx}px, ${dy2}px) scale(${scaleX}, ${scaleY})`;
      overlay.style.opacity = "0.4";
    } else {
      overlay.style.opacity = "0";
    }

    overlay.addEventListener("transitionend", cleanup, { once: true });
    setTimeout(cleanup, 380);
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    root.remove();
    onClose?.();
  }

  return { close };
}
