// components/profileHeader.js
import { el } from "../utils/dom.js";

const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#3897f0"/><path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LINK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e93a3" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/></svg>`;
const MUSIC_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#8e93a3"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const BACK_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const MORE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`;
const ADD_PERSON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.6 3.6-5.5 6.5-5.5s5.5 1.9 6.5 5.5"/><line x1="18" y1="8" x2="18" y2="14"/><line x1="15" y1="11" x2="21" y2="11"/></svg>`;

function statBlock(value, label) {
  return el("div", { class: "ig-stat" }, [
    el("span", { class: "ig-stat-value" }, String(value)),
    el("span", { class: "ig-stat-label" }, label),
  ]);
}

export function createProfileHeader(profile, highlights, { onAvatarTap, onHighlightTap } = {}) {
  const avatarRing = el("div", { class: "ig-avatar-ring", onClick: () => onAvatarTap?.() }, [
    el("img", { class: "ig-avatar", src: profile.avatar, alt: profile.name, loading: "eager" }),
  ]);

  const nameRow = el("div", { class: "ig-name-row" }, [
    el("span", { class: "ig-name" }, profile.name.replace(/\s*💖$/, "")),
    profile.verified ? el("span", { class: "ig-verified", html: CHECK_SVG }) : null,
  ]);

  const stats = el("div", { class: "ig-stats" }, [
    statBlock(profile.postsCount, "posts"),
    statBlock(profile.followers, "seguidores"),
    statBlock(profile.following, "seguindo"),
  ]);

  const bio = el("div", { class: "ig-bio" }, profile.bioLines.map((line) => el("div", {}, line)));

  const linkRow = el("a", { class: "ig-link-row", href: profile.link.url, target: "_blank", rel: "noopener" }, [
    el("span", { class: "ig-row-icon", html: LINK_SVG }),
    el("span", { class: "ig-link-text" }, profile.link.label),
  ]);

  const musicRow = el("div", { class: "ig-music-row" }, [
    el("span", { class: "ig-row-icon", html: MUSIC_SVG }),
    el("span", { class: "ig-music-text" }, profile.music),
  ]);

  const actions = el("div", { class: "ig-actions" }, [
    el("button", { class: "ig-btn ig-btn-follow", type: "button" }, "Seguir"),
    el("button", { class: "ig-btn ig-btn-message", type: "button" }, "Mensagem"),
    el("button", { class: "ig-btn ig-btn-add", type: "button", html: ADD_PERSON_SVG }),
  ]);

  const highlightsRow = el("div", { class: "ig-highlights" },
    highlights.map((h) =>
      el("button", { class: "ig-highlight", type: "button", onClick: () => onHighlightTap?.(h) }, [
        el("span", { class: "ig-highlight-ring" }, [
          el("img", { class: "ig-highlight-img", src: h.cover, alt: h.label, loading: "lazy" }),
        ]),
        el("span", { class: "ig-highlight-label" }, h.label),
      ])
    )
  );

  const topNav = el("div", { class: "ig-topnav" }, [
    el("button", {
      class: "ig-topnav-back", type: "button", html: BACK_SVG,
      onClick: () => { try { window.Telegram?.WebApp?.close(); } catch {} },
    }),
    el("span", { class: "ig-topnav-username" }, profile.username),
    profile.verified ? el("span", { class: "ig-topnav-verified", html: CHECK_SVG }) : null,
    el("div", { class: "ig-topnav-spacer" }),
    el("button", { class: "ig-topnav-more", type: "button", html: MORE_SVG }),
  ]);

  // nome fica empilhado acima das estatísticas, os dois ao lado do avatar
  // (não numa linha própria abaixo) — layout da referência.
  const headCol = el("div", { class: "ig-headcol" }, [nameRow, stats]);
  const topRow = el("div", { class: "ig-top-row" }, [avatarRing, headCol]);

  return el("section", { class: "ig-profile-header" }, [
    topNav,
    topRow,
    bio,
    linkRow,
    musicRow,
    actions,
    highlightsRow,
  ]);
}
