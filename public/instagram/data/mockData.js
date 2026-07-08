// data/mockData.js
// Fonte única de conteúdo do mini app. Trocar mídias/textos aqui não exige
// tocar em nenhum componente — é o ponto de integração futuro com uma API real.

const A = "../assets/";

export const PROFILE = {
  avatar: A + "photo_5062262078608968721_w.jpg",
  name: "Alana Lemes 💖",
  username: "alanalemes",
  verified: true,
  postsCount: 9,
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
    { type: "video", src: A + "IMG_1382.MOV" },
    { type: "video", src: A + "IMG_7088.MOV" },
  ],
};

// destaques (highlights) — cada um abre seu próprio viewer
export const HIGHLIGHTS = [
  {
    id: "vip",
    label: "VIP 🔥",
    cover: A + "photo_5071206571341188083_w.jpg",
    items: [
      { type: "image", src: A + "photo_5071206571341188083_w.jpg" },
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
  A + "IMG_6904.MP4",
  A + "IMG_6939.MP4",
  A + "IMG_7066.MP4",
  A + "IMG_7067.MP4",
  A + "IMG_7068.MP4",
  A + "IMG_7069.MP4",
];

const imagePosts = [
  A + "photo_5067007776952880376_w.jpg",
  A + "photo_5071206571341188083_w.jpg",
  A + "photo_5062262078608968721_w.jpg",
];

export const POSTS = [
  ...imagePosts.map((src, i) => ({
    id: `img-${i}`,
    type: "image",
    src,
  })),
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
}));
