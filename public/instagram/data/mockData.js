// data/mockData.js
// Fonte única de conteúdo do mini app. Trocar mídias/textos aqui não exige
// tocar em nenhum componente — é o ponto de integração futuro com uma API real.

const A = "../assets/";

export const PROFILE = {
  avatar: A + "405488468_867245554865727_7074750915997033131_n.jpg",
  name: "Gabriely Castro 💖",
  username: "gabriely_castro",
  verified: true,
  postsCount: 8,
  followers: "122 mil",
  following: 405,
  bioLines: [
    "OLHEM OS STORYS 👆👀",
    "18 aninhos",
    "Conteúdos diários sem censura 🔥",
  ],
  link: { label: "privacy.com.br/alana", url: "#" },
  music: "Vem Me Satisfazer · Sua Música",
};

// story do avatar principal (anel ao redor da foto de perfil)
export const PROFILE_STORY = {
  name: PROFILE.name,
  avatar: PROFILE.avatar,
  items: [
    { type: "video", src: A + "ig-reel-1.mp4" },
    { type: "video", src: A + "ig-reel-2.mp4" },
  ],
};

// destaques (highlights) — cada um abre seu próprio viewer
export const HIGHLIGHTS = [
  {
    id: "vip",
    label: "VIP 🔥",
    cover: A + "Telegram-Logo.png",
    items: [
      { type: "image", src: A + "ig-highlight-1.jpeg" },
    ],
  },
];

const CAPTIONS = [
  "boa noite, gostosos 😈🔥",
  "tava com saudade de vocês… 💋",
  "quem quiser ver mais, sabe onde me achar 👀",
  "hoje o clima tá diferente 🥵",
  "só pra quem merece ver isso inteiro 🔒",
  "adivinha o que rolou depois dessa gravação 😏",
  "vim aqui só pra provocar mesmo 💦",
  "não presta atenção só na legenda não 😈",
  "salvei o melhor pra esse post 🔥",
];

const MOCK_COMMENTS = [
  { user: "joao.silva92", text: "perfeita 😍🔥" },
  { user: "pedro_alves", text: "arrasou demais" },
  { user: "lucas.rj", text: "não aguento mais esperar pelo próximo 🥵" },
  { user: "marcos_ferreira", text: "linda demais mulher" },
];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const videoPosts = [
  A + "ig-reel-1.mp4",
  A + "ig-reel-2.mp4",
  A + "ig-reel-3.mp4",
  A + "ig-reel-4.mp4",
  A + "ig-reel-5.mp4",
  A + "ig-reel-6.mp4",
  A + "ig-reel-7.mp4",
  A + "ig-reel-8.mp4",
];

export const POSTS = [
  ...videoPosts.map((src, i) => ({
    id: `vid-${i}`,
    type: "video",
    src,
  })),
].map((post, i) => ({
  ...post,
  caption: CAPTIONS[i % CAPTIONS.length],
  likes: rand(1800, 9600),
  comments: MOCK_COMMENTS,
  pinned: i === 0,
}));

// aba "Reels" — todo post em vídeo funciona como reel nesse mock
export const REELS = POSTS.filter((p) => p.type === "video");

// aba "Marcados" — nada marcado ainda (estado vazio, igual Instagram real)
export const TAGGED = [];
