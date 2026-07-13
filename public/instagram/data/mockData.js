// data/mockData.js
// Fonte única de conteúdo do mini app. Trocar mídias/textos aqui não exige
// tocar em nenhum componente — é o ponto de integração futuro com uma API real.

const A = "../assets/";

export const PROFILE = {
  avatar: A + "405488468_867245554865727_7074750915997033131_n.jpg",
  name: "Susana Barbosa 💖",
  username: "susana_barbosa",
  verified: true,
  postsCount: 7,
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
  A + "DU0kh07Dbx6.mp4",
  A + "DWJmaAbjRAx.mp4",
  A + "DXHZFcQDUNO_1.mp4",
  A + "DXM-m3ric7o.mp4",
  A + "DXMiCuVDe1P.mp4",
  A + "DYA0vrApG1V.mp4",
  A + "Dasp1yqxPnH.mp4",
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
}));
