// app.js — bootstrap do mini app
import { el } from "./utils/dom.js";
import { PROFILE, PROFILE_STORY, HIGHLIGHTS, POSTS, REELS } from "./data/mockData.js";
import { createProfileHeader } from "./components/profileHeader.js";
import { createProfileTabs } from "./components/profileTabs.js";
import { createFeedGrid, createReelGrid, createTaggedGrid } from "./components/feedGrid.js";
import { createBottomNav } from "./components/bottomNav.js";
import { openStoryViewer } from "./components/stories.js";
import { openPostViewer } from "./components/postViewer.js";
import { openReelsViewer } from "./components/reelsViewer.js";

function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();
  if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
  if (tg.setHeaderColor) { try { tg.setHeaderColor("#000000"); } catch {} }
  if (tg.setBackgroundColor) { try { tg.setBackgroundColor("#000000"); } catch {} }

  if (tg.BackButton) {
    tg.BackButton.show();
    tg.BackButton.onClick(() => { try { tg.close(); } catch {} });
  }

  const chatId = tg.initDataUnsafe?.user?.id;
  if (chatId) {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: String(chatId), event: "INSTAGRAM_MINIAPP_OPEN" }),
      keepalive: true,
    }).catch(() => {});
  }
}

function mountApp() {
  const app = document.getElementById("app");

  const header = createProfileHeader(PROFILE, HIGHLIGHTS, {
    onAvatarTap: () => openStoryViewer({ name: PROFILE_STORY.name, avatar: PROFILE_STORY.avatar, items: PROFILE_STORY.items }),
    onHighlightTap: (h) => openStoryViewer({ name: h.label, avatar: h.cover, items: h.items }),
  });

  // conteúdo do feed troca por dentro desse container — sem recarregar a página
  const feedHost = el("div", { class: "ig-feed-host" });
  const renderFeed = (key) => {
    feedHost.innerHTML = "";
    if (key === "reels") {
      feedHost.appendChild(createReelGrid(REELS, (i, rect) => openReelsViewer(REELS, i, rect, { profile: PROFILE })));
    } else if (key === "tagged") {
      feedHost.appendChild(createTaggedGrid());
    } else {
      feedHost.appendChild(createFeedGrid(POSTS, (i) => openPostViewer(PROFILE, POSTS, i)));
    }
  };

  const tabs = createProfileTabs("posts", renderFeed);
  renderFeed("posts");

  const nav = createBottomNav("profile");

  app.appendChild(el("div", { class: "ig-page" }, [
    el("div", { class: "ig-scroll" }, [header, tabs, feedHost]),
    nav,
  ]));
}

initTelegram();
mountApp();
