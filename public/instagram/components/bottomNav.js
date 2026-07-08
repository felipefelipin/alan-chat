// components/bottomNav.js
import { el } from "../utils/dom.js";

const ICONS = {
  home: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>`,
  search: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>`,
  add: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  reels: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M7 4 10 9M14 4l3 5"/></svg>`,
  profile: `<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>`,
};

export function createBottomNav(activeKey = "profile") {
  const items = ["home", "search", "add", "reels", "profile"].map((key) =>
    el("button", {
      class: "ig-nav-btn" + (key === activeKey ? " ig-nav-btn-active" : ""),
      type: "button",
      html: ICONS[key],
      dataset: { navKey: key },
    })
  );

  return el("nav", { class: "ig-bottom-nav" }, items);
}
