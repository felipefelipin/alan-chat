// components/postViewer.js
// Viewer de post em tela cheia: pager horizontal entre posts (drag-follow +
// snap), swipe vertical fecha, duplo toque curte com animação de coração.
// Like/comentário/salvar são estado local (mock) — pronto pra virar chamada de API.

import { el, formatCount } from "../utils/dom.js";

const CLOSE_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const MORE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
const HEART_OUTLINE = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4.5c2.1 0 3.6 1.2 6 3.7 2.4-2.5 3.9-3.7 6-3.7 3.7 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
const HEART_FILLED = `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ff3040"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4.5c2.1 0 3.6 1.2 6 3.7 2.4-2.5 3.9-3.7 6-3.7 3.7 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
const COMMENT_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-4-1L3 20l1.2-4A8.4 8.4 0 0 1 3 11.5 8.5 8.5 0 0 1 20 8.5"/></svg>`;
const SHARE_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;
const SAVE_OUTLINE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>`;
const SAVE_FILLED = `<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>`;
const BIG_HEART = `<svg width="90" height="90" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4.5c2.1 0 3.6 1.2 6 3.7 2.4-2.5 3.9-3.7 6-3.7 3.7 0 5.5 3.7 4 7.2C19.5 16.4 12 21 12 21z"/></svg>`;
const SEND_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;

function openCommentsSheet(profileName, comments, onAdd) {
  const list = el("div", { class: "cm-list" }, comments.map(commentRow));

  function commentRow(c) {
    return el("div", { class: "cm-row" }, [
      el("span", { class: "cm-user" }, c.user),
      el("span", { class: "cm-text" }, " " + c.text),
    ]);
  }

  const input = el("input", { class: "cm-input", type: "text", placeholder: "Adicione um comentário..." });
  const sendBtn = el("button", { class: "cm-send", type: "button", html: SEND_SVG });

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    const c = { user: "você", text };
    list.appendChild(commentRow(c));
    list.scrollTop = list.scrollHeight;
    input.value = "";
    onAdd?.(c);
  }
  sendBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const sheet = el("div", { class: "cm-sheet" }, [
    el("div", { class: "cm-handle" }),
    el("div", { class: "cm-title" }, "Comentários"),
    list,
    el("div", { class: "cm-compose" }, [input, sendBtn]),
  ]);
  const backdrop = el("div", { class: "cm-backdrop" }, [sheet]);

  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) dismiss(); });
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("cm-backdrop-in"));

  function dismiss() {
    backdrop.classList.remove("cm-backdrop-in");
    setTimeout(() => backdrop.remove(), 220);
  }

  return { dismiss };
}

function createSlide(profile, post, index) {
  const state = {
    liked: false,
    saved: false,
    likeCount: post.likes,
    comments: [...post.comments],
  };

  let video = null;
  const mediaWrap = el("div", { class: "pv-media-wrap" });
  if (post.type === "video") {
    video = el("video", {
      class: "pv-media", src: post.src, playsinline: "", "webkit-playsinline": "",
      muted: "", loop: "", preload: "metadata",
    });
    mediaWrap.appendChild(video);
  } else {
    mediaWrap.appendChild(el("img", { class: "pv-media", src: post.src, alt: "" }));
  }

  const bigHeart = el("div", { class: "pv-big-heart", html: BIG_HEART });
  mediaWrap.appendChild(bigHeart);

  const likeBtn = el("button", { class: "pv-action", type: "button", html: HEART_OUTLINE });
  const likeCountEl = el("span", { class: "pv-like-count" }, formatCount(state.likeCount) + " curtidas");
  const commentBtn = el("button", { class: "pv-action", type: "button", html: COMMENT_SVG });
  const commentCountEl = el("button", { class: "pv-comment-link", type: "button" },
    state.comments.length ? `Ver todos os ${state.comments.length} comentários` : "Seja o primeiro a comentar");
  const shareBtn = el("button", { class: "pv-action", type: "button", html: SHARE_SVG });
  const saveBtn = el("button", { class: "pv-action pv-save", type: "button", html: SAVE_OUTLINE });

  function refreshLikeUI() {
    likeBtn.innerHTML = state.liked ? HEART_FILLED : HEART_OUTLINE;
    likeCountEl.textContent = formatCount(state.likeCount) + " curtidas";
  }
  function toggleLike(forceLiked) {
    const newLiked = forceLiked ?? !state.liked;
    if (newLiked === state.liked) return;
    state.liked = newLiked;
    state.likeCount += newLiked ? 1 : -1;
    refreshLikeUI();
  }
  likeBtn.addEventListener("click", () => toggleLike());

  saveBtn.addEventListener("click", () => {
    state.saved = !state.saved;
    saveBtn.innerHTML = state.saved ? SAVE_FILLED : SAVE_OUTLINE;
  });

  function refreshCommentLink() {
    commentCountEl.textContent = state.comments.length
      ? `Ver todos os ${state.comments.length} comentários`
      : "Seja o primeiro a comentar";
  }

  function openComments() {
    openCommentsSheet(profile.name, state.comments, (c) => {
      state.comments.push(c);
      refreshCommentLink();
    });
  }
  commentBtn.addEventListener("click", openComments);
  commentCountEl.addEventListener("click", openComments);
  shareBtn.addEventListener("click", () => flashToast(mediaWrap, "Link copiado"));

  // duplo toque pra curtir, com animação de coração
  let lastTap = 0;
  mediaWrap.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      toggleLike(true);
      bigHeart.classList.remove("pv-big-heart-pop");
      void bigHeart.offsetWidth; // reinicia a animação se já estava tocando
      bigHeart.classList.add("pv-big-heart-pop");
    }
    lastTap = now;
  });

  const header = el("div", { class: "pv-header" }, [
    el("img", { class: "pv-header-avatar", src: profile.avatar, alt: profile.name }),
    el("span", { class: "pv-header-name" }, profile.name.replace(/\s*💖$/, "")),
    el("div", { class: "pv-header-spacer" }),
    el("button", { class: "pv-icon-btn", type: "button", html: MORE_SVG }),
  ]);

  const actionsRow = el("div", { class: "pv-actions-row" }, [
    likeBtn, commentBtn, shareBtn,
    el("div", { class: "pv-actions-spacer" }),
    saveBtn,
  ]);

  const caption = el("div", { class: "pv-caption" }, [
    el("span", { class: "pv-caption-user" }, profile.username),
    el("span", {}, " " + post.caption),
  ]);

  const footer = el("div", { class: "pv-footer" }, [
    actionsRow, likeCountEl, caption, commentCountEl,
  ]);

  const root = el("div", { class: "pv-slide" }, [header, mediaWrap, footer]);

  return { root, video };
}

function flashToast(host, text) {
  const toast = el("div", { class: "pv-toast" }, text);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("pv-toast-in"));
  setTimeout(() => { toast.classList.remove("pv-toast-in"); setTimeout(() => toast.remove(), 200); }, 1400);
}

export function openPostViewer(profile, posts, startIndex, { onClose } = {}) {
  let index = startIndex;
  let dragAxis = null;
  let startX = 0, startY = 0, dx = 0, dy = 0, active = false;
  let destroyed = false;

  const slides = posts.map((post, i) => createSlide(profile, post, i));
  const pager = el("div", { class: "pv-pager" }, slides.map((s) => s.root));

  const closeBtn = el("button", { class: "pv-icon-btn pv-close-btn", type: "button", html: CLOSE_SVG, onClick: () => close() });
  const overlay = el("div", { class: "pv-overlay" }, [closeBtn, pager]);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("pv-overlay-in"));

  function setTransform(withTransition) {
    pager.style.transition = withTransition ? "transform .28s cubic-bezier(.22,.61,.36,1)" : "none";
    pager.style.transform = `translateX(${-index * 100}%)`;
  }

  function playActiveVideo() {
    slides.forEach((s, i) => {
      if (!s.video) return;
      if (i === index) s.video.play().catch(() => {});
      else s.video.pause();
    });
  }

  function goTo(newIndex) {
    index = Math.max(0, Math.min(posts.length - 1, newIndex));
    setTransform(true);
    playActiveVideo();
  }

  function close() {
    if (destroyed) return;
    destroyed = true;
    slides.forEach((s) => s.video?.pause());
    overlay.classList.remove("pv-overlay-in");
    overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 260);
    onClose?.();
  }

  pager.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0; dy = 0; active = true; dragAxis = null;
  }, { passive: true });

  pager.addEventListener("touchmove", (e) => {
    if (!active) return;
    const t = e.touches[0];
    dx = t.clientX - startX; dy = t.clientY - startY;
    if (!dragAxis) dragAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";

    if (dragAxis === "x") {
      pager.style.transition = "none";
      pager.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
    } else {
      const clampedDy = Math.max(0, dy);
      overlay.style.transition = "none";
      overlay.style.transform = `translateY(${clampedDy}px) scale(${Math.max(0.9, 1 - clampedDy / 1600)})`;
      overlay.style.opacity = String(Math.max(0.5, 1 - clampedDy / 400));
    }
  }, { passive: true });

  pager.addEventListener("touchend", () => {
    if (!active) return;
    active = false;

    if (dragAxis === "x") {
      if (Math.abs(dx) > 70) goTo(index + (dx < 0 ? 1 : -1));
      else goTo(index);
    } else if (dragAxis === "y") {
      if (dy > 110) { close(); return; }
      overlay.style.transition = "transform .22s ease, opacity .22s ease";
      overlay.style.transform = "";
      overlay.style.opacity = "";
    }
    dragAxis = null;
  });

  setTransform(false);
  playActiveVideo();

  return { close };
}
