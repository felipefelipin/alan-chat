// components/stories.js
// Viewer de story em tela cheia — usado tanto pro anel do avatar quanto pros destaques.
// Progresso animado via rAF + transform (scaleX), sem reflow.

import { el } from "../utils/dom.js";
import { attachStoryGestures } from "../utils/gestures.js";

const IMAGE_DURATION = 5000;
const CLOSE_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const SEND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;

export function openStoryViewer({ name, avatar, items, onClose }) {
  let index = 0;
  let rafId = null;
  let itemStart = 0;
  let pausedAt = 0;
  let paused = false;
  let videoEl = null;
  let destroyed = false;

  const bars = items.map(() => {
    const fill = el("div", { class: "story-bar-fill" });
    return { root: el("div", { class: "story-bar-track" }, [fill]), fill };
  });

  const barsRow = el("div", { class: "story-bars" }, bars.map((b) => b.root));

  const header = el("div", { class: "story-header" }, [
    barsRow,
    el("div", { class: "story-header-row" }, [
      el("img", { class: "story-header-avatar", src: avatar, alt: name }),
      el("span", { class: "story-header-name" }, name),
      el("span", { class: "story-header-time" }, "2h"),
      el("div", { class: "story-header-spacer" }),
      el("button", { class: "story-close-btn", type: "button", html: CLOSE_SVG, onClick: () => close() }),
    ]),
  ]);

  const mediaHost = el("div", { class: "story-media-host" });

  const replyRow = el("div", { class: "story-reply-row" }, [
    el("input", { class: "story-reply-input", type: "text", placeholder: `Responder para ${name}...` }),
    el("button", { class: "story-send-btn", type: "button", html: SEND_SVG }),
  ]);

  const overlay = el("div", { class: "story-overlay" }, [header, mediaHost, replyRow]);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("story-overlay-in"));

  const sendBtn = replyRow.querySelector(".story-send-btn");
  const replyInput = replyRow.querySelector(".story-reply-input");
  sendBtn.addEventListener("click", () => { replyInput.value = ""; replyInput.blur(); });
  replyInput.addEventListener("focus", () => setPaused(true));
  replyInput.addEventListener("blur", () => setPaused(false));

  function renderMedia() {
    mediaHost.innerHTML = "";
    videoEl = null;
    const item = items[index];

    if (item.type === "video") {
      videoEl = el("video", {
        class: "story-media",
        src: item.src,
        playsinline: "",
        "webkit-playsinline": "",
        muted: "",
        preload: "auto",
      });
      mediaHost.appendChild(videoEl);
      videoEl.play().catch(() => {});
      videoEl.addEventListener("ended", next);
    } else {
      mediaHost.appendChild(el("img", { class: "story-media", src: item.src, alt: "" }));
    }
  }

  function itemDuration() {
    if (items[index].type === "video" && videoEl?.duration) return videoEl.duration * 1000;
    return IMAGE_DURATION;
  }

  function startProgress() {
    itemStart = performance.now();
    pausedAt = 0;
    tick();
  }

  function tick() {
    if (destroyed) return;
    if (!paused) {
      const dur = itemDuration();
      const elapsed = performance.now() - itemStart;
      const progress = Math.min(1, elapsed / dur);
      bars[index].fill.style.transform = `scaleX(${progress})`;
      if (progress >= 1) { next(); return; }
    }
    rafId = requestAnimationFrame(tick);
  }

  function setPaused(next) {
    if (paused === next) return;
    paused = next;
    if (videoEl) { paused ? videoEl.pause() : videoEl.play().catch(() => {}); }
    if (paused) {
      pausedAt = performance.now();
    } else {
      itemStart += performance.now() - pausedAt;
    }
  }

  function goTo(newIndex) {
    if (newIndex < 0) { close(); return; }
    if (newIndex >= items.length) { close(); return; }
    bars.forEach((b, i) => { b.fill.style.transform = `scaleX(${i < newIndex ? 1 : 0})`; });
    index = newIndex;
    renderMedia();
    startProgress();
  }

  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }

  function close() {
    if (destroyed) return;
    destroyed = true;
    if (rafId) cancelAnimationFrame(rafId);
    detachGestures();
    overlay.classList.remove("story-overlay-in");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 260); // fallback se transitionend não disparar
    onClose?.();
  }

  const detachGestures = attachStoryGestures(mediaHost, {
    onTapLeft: prev,
    onTapRight: next,
    onHoldStart: () => setPaused(true),
    onHoldEnd: () => setPaused(false),
    onSwipeDown: close,
    onSwipeHorizontal: close,
    onDragY: (dy) => {
      overlay.style.transform = `translateY(${Math.min(dy, 160)}px)`;
      overlay.style.opacity = String(Math.max(0.4, 1 - dy / 400));
    },
  });

  overlay.addEventListener("touchend", () => {
    overlay.style.transform = "";
    overlay.style.opacity = "";
  });

  goTo(0);

  return { close };
}
