// components/feedGrid.js
// Grid 3 colunas com lazy load — a mídia só entra no DOM quando a célula
// está prestes a entrar na viewport (IntersectionObserver via onVisible).

import { el, onVisible } from "../utils/dom.js";

const PLAY_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>`;

function createCell(post, index, onTap) {
  const cell = el("button", { class: "ig-grid-cell", type: "button", onClick: () => onTap(index) });

  onVisible(cell, () => {
    if (post.type === "video") {
      const video = el("video", {
        class: "ig-grid-media",
        src: post.src,
        muted: "",
        playsinline: "",
        "webkit-playsinline": "",
        preload: "metadata",
      });
      cell.appendChild(video);
      cell.appendChild(el("span", { class: "ig-grid-play", html: PLAY_SVG }));
    } else {
      cell.appendChild(el("img", { class: "ig-grid-media", src: post.src, alt: "", loading: "lazy" }));
    }
  });

  return cell;
}

export function createFeedGrid(posts, onOpenPost) {
  return el("div", { class: "ig-grid" }, posts.map((post, i) => createCell(post, i, onOpenPost)));
}
