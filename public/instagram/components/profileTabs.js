// components/profileTabs.js
// Três abas (Publicações / Reels / Marcados) com indicador inferior fino na
// aba ativa. Troca de conteúdo é responsabilidade de quem usa (onChange) —
// esse componente só cuida da navegação em si.

import { el } from "../utils/dom.js";

const GRID_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
  <rect x="3" y="3" width="5.6" height="5.6" rx="1"/>
  <rect x="9.2" y="3" width="5.6" height="5.6" rx="1"/>
  <rect x="15.4" y="3" width="5.6" height="5.6" rx="1"/>
  <rect x="3" y="9.2" width="5.6" height="5.6" rx="1"/>
  <rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1"/>
  <rect x="15.4" y="9.2" width="5.6" height="5.6" rx="1"/>
  <rect x="3" y="15.4" width="5.6" height="5.6" rx="1"/>
  <rect x="9.2" y="15.4" width="5.6" height="5.6" rx="1"/>
  <rect x="15.4" y="15.4" width="5.6" height="5.6" rx="1"/>
</svg>`;

const REELS_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2.5" y="4.5" width="19" height="15" rx="3"/>
  <path d="M7 4.5 9.8 9M14.5 4.5 17.3 9"/>
  <path d="M10.3 11.2v4.6l4-2.3z" fill="currentColor" stroke="none"/>
</svg>`;

const TAGGED_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="3"/>
  <circle cx="12" cy="10" r="3"/>
  <path d="M6.5 18c1-2.8 3.2-4 5.5-4s4.5 1.2 5.5 4"/>
</svg>`;

const TABS = [
  { key: "posts",   icon: GRID_SVG },
  { key: "reels",   icon: REELS_SVG },
  { key: "tagged",  icon: TAGGED_SVG },
];

export function createProfileTabs(initialKey, onChange) {
  const buttons = new Map();

  const root = el("div", { class: "ig-tabs" },
    TABS.map((tab) => {
      const btn = el("button", {
        class: "ig-tab" + (tab.key === initialKey ? " ig-tab-active" : ""),
        type: "button",
        html: tab.icon,
        onClick: () => setActive(tab.key),
      });
      buttons.set(tab.key, btn);
      return btn;
    })
  );

  function setActive(key) {
    for (const [k, btn] of buttons) btn.classList.toggle("ig-tab-active", k === key);
    onChange?.(key);
  }

  return root;
}
