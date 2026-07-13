// components/feedGrid.js
// Grid 3 colunas (Publicações / Reels) e estado vazio (Marcados).
// Cada peça tem uma responsabilidade só: LazyImage cuida do carregamento
// progressivo, VideoIndicator/PinnedIndicator são só o ícone, FeedItem monta
// a célula, FeedGrid/ReelGrid/TaggedGrid decidem o que renderizar.

import { el, onVisible } from "../utils/dom.js";

const PLAY_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="rgba(255,255,255,.92)"><path d="M8 5v14l11-7z"/></svg>`;
const PIN_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(255,255,255,.92)"><path d="M14.5 2.5 21.5 9.5 17 14l-1 7-3.5-3.5L6 24l-.5-.5 6.5-6.5L8.5 13.5 9.5 9z"/></svg>`;

// ── VideoIndicator ───────────────────────────────────────────────────────────
function createVideoIndicator() {
  return el("span", { class: "ig-grid-badge ig-grid-badge-video", html: PLAY_SVG });
}

// ── PinnedIndicator ──────────────────────────────────────────────────────────
function createPinnedIndicator() {
  return el("span", { class: "ig-grid-badge ig-grid-badge-pin", html: PIN_SVG });
}

// ── LazyImage/LazyVideo — só entra no DOM perto da viewport, fade-in ao carregar ──
function mountLazyMedia(cell, post) {
  if (post.type === "video") {
    const video = el("video", {
      class: "ig-grid-media",
      src: post.src,
      muted: "",
      playsinline: "",
      "webkit-playsinline": "",
      preload: "metadata",
    });
    // preload="metadata" não desenha nenhum frame sozinho — força um seek
    // minúsculo assim que a duração é conhecida pra usar esse frame como capa,
    // sem baixar o vídeo inteiro.
    video.addEventListener("loadedmetadata", () => {
      try { video.currentTime = Math.min(0.15, (video.duration || 1) / 2); } catch {}
    }, { once: true });
    video.addEventListener("seeked", () => video.classList.add("ig-grid-media-ready"), { once: true });
    cell.appendChild(video);
    cell.appendChild(createVideoIndicator());
  } else {
    const img = el("img", { class: "ig-grid-media", src: post.src, alt: "", loading: "lazy" });
    img.addEventListener("load", () => img.classList.add("ig-grid-media-ready"), { once: true });
    cell.appendChild(img);
  }
}

// ── FeedItem ─────────────────────────────────────────────────────────────────
function createFeedItem(post, index, onTap) {
  const cell = el("button", { class: "ig-grid-cell", type: "button", onClick: () => onTap(index) });
  cell.appendChild(el("span", { class: "ig-grid-skeleton" }));
  if (post.pinned) cell.appendChild(createPinnedIndicator());

  onVisible(cell, () => mountLazyMedia(cell, post));

  return cell;
}

function grid(posts, onOpenPost) {
  return el("div", { class: "ig-grid" }, posts.map((post, i) => createFeedItem(post, i, onOpenPost)));
}

// ── FeedGrid — aba Publicações ───────────────────────────────────────────────
export function createFeedGrid(posts, onOpenPost) {
  return grid(posts, onOpenPost);
}

// ── ReelGrid — aba Reels ─────────────────────────────────────────────────────
export function createReelGrid(reels, onOpenReel) {
  return grid(reels, onOpenReel);
}

// ── TaggedGrid — aba Marcados (estado vazio) ─────────────────────────────────
export function createTaggedGrid() {
  return el("div", { class: "ig-empty-state" }, [
    el("div", { class: "ig-empty-icon" }, "🏷️"),
    el("div", { class: "ig-empty-title" }, "Nenhuma foto"),
    el("div", { class: "ig-empty-sub" }, "Fotos em que você foi marcada aparecem aqui."),
  ]);
}
