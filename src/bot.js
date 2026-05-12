// src/bot.js
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { mpCreatePreference } = require("../payments/mp");

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const jid  = (...parts) => parts.join("-");

async function upsertUser(chatId) {
  return prisma.user.upsert({
    where:  { id: String(chatId) },
    update: {},
    create: { id: String(chatId), etapa: "start", pagou: false },
  });
}

async function setEtapa(chatId, etapa) {
  await prisma.user.update({ where: { id: String(chatId) }, data: { etapa } });
}

function enqueue(type, chatId, data, delay = 0) {
  return queue.add(
    "jobs",
    { type, chatId: String(chatId), data },
    { delay, removeOnComplete: true, removeOnFail: true }
  );
}

// Teclado numérico 1-10 em duas linhas
function numGrid(round) {
  return {
    inline_keyboard: [
      [1, 2, 3, 4, 5].map(n  => ({ text: String(n), callback_data: `num${round}_${n}` })),
      [6, 7, 8, 9, 10].map(n => ({ text: String(n), callback_data: `num${round}_${n}` })),
    ],
  };
}

// ─── Checkout + pagamento ─────────────────────────────────────────────────────
async function createCheckoutAndSend(chatId, plano) {
  const { preferenceId, initPoint } = await mpCreatePreference({ chatId, plano });

  await prisma.payment.create({
    data: { userId: String(chatId), plano, status: "pending", preferenceId, initPoint },
  });

  await enqueue("SEND_MESSAGE", chatId, { text: "boa.", autoSplit: true },             rand(1200, 2000));
  await enqueue("SEND_MESSAGE", chatId, { text: "paga aqui e volta pra mim.", autoSplit: true }, rand(2800, 4600));
  await enqueue("SEND_MESSAGE", chatId, {
    text: "👇",
    extra: { reply_markup: { inline_keyboard: [[{ text: "💳 pagar agora", url: initPoint }]] } },
  }, rand(4600, 6200));

  await setEtapa(chatId, "pagamento");
}

// =============================================================================
// /start
// =============================================================================
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await upsertUser(chatId);
  await setEtapa(chatId, "start");

  let t = rand(500, 1000);

  // 1) Foto provocante
  await enqueue("SEND_PHOTO", chatId, { file: "intro.jpg", caption: "" }, t);

  // 2) Mensagem + 3 botões
  t += rand(1600, 2600);
  await enqueue("SEND_MESSAGE", chatId, {
    text: "Oi gato 😈\n\nAcabei de acordar toda molhada pensando em um homem de verdade...\n\nTá tudo bem por aí?",
    extra: {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Tô bem 🔥",           callback_data: "start_sim"   }],
          [{ text: "Tô ótimo, e você? 😏", callback_data: "start_otimo" }],
          [{ text: "Tô afim de você 💦",   callback_data: "start_afim"  }],
        ],
      },
    },
  }, t);
});

// =============================================================================
// Callbacks
// =============================================================================
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data   = q.data || "";
  if (!chatId || !data) return;

  await bot.answerCallbackQuery(q.id).catch(() => {});

  try {

    // ── Passo 1 → Passo 2 ───────────────────────────────────────────────────
    if (["start_sim", "start_otimo", "start_afim"].includes(data)) {
      await setEtapa(chatId, "step2");
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Que bom... Eu também tô bem, mas bem safadinha hoje 👀💦\n\nSabe, eu só faço chamada de vídeo peladinha pra quem realmente me excita de verdade...\n\nTopa uma chamada bem gostosa e sem censura comigo agora?",
        extra: {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Quero sim 😈",              callback_data: "quero_video"     }],
              [{ text: "Tô afim pra caralho 🔥",    callback_data: "quero_video"     }],
              [{ text: "Me mostra primeiro",         callback_data: "mostra_primeiro" }],
            ],
          },
        },
      }, rand(800, 1500));
      return;
    }

    // ── Passo 2 → Passo 3 (intro roleta) ────────────────────────────────────
    if (["quero_video", "mostra_primeiro"].includes(data)) {
      await setEtapa(chatId, "roleta");
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Perfeito 😏\n\nMas pra me ver toda peladinha, e me ter bem putinha em um privado bem secreto, a gente vai ter que brincar de roleta da sorte.\n\nQuer tentar a sorte?",
        extra: {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Quero tentar a sorte 🎰",   callback_data: "tentar_roleta_1" }],
              [{ text: "Tô com muita sorte hoje 😈", callback_data: "tentar_roleta_1" }],
            ],
          },
        },
      }, rand(800, 1500));
      return;
    }

    // ── Roleta round 1 — grade numérica ─────────────────────────────────────
    if (data === "tentar_roleta_1") {
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Escolhe um número de 1 a 10:",
        extra: { reply_markup: numGrid(1) },
      }, rand(600, 1100));
      return;
    }

    // ── Roleta round 2 — grade numérica ─────────────────────────────────────
    if (data === "tentar_roleta_2") {
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Última chance! Escolhe seu número de 1 a 10:",
        extra: { reply_markup: numGrid(2) },
      }, rand(600, 1100));
      return;
    }

    // ── Número escolhido — round 1 ───────────────────────────────────────────
    const m1 = data.match(/^num1_(\d+)$/);
    if (m1) {
      const chosen = m1[1];
      await enqueue("SEND_MESSAGE", chatId, {
        text: `Beleza! Escolheu o <b>${chosen}</b>.\n\nVou girar a roleta...`,
        extra: {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🎰 Girar Roleta", callback_data: `spin1_${chosen}` }]],
          },
        },
      }, rand(700, 1300));
      return;
    }

    // ── Número escolhido — round 2 ───────────────────────────────────────────
    const m2 = data.match(/^num2_(\d+)$/);
    if (m2) {
      const chosen = m2[1];
      await enqueue("SEND_MESSAGE", chatId, {
        text: `Beleza! Escolheu o <b>${chosen}</b>.\n\nVou girar a roleta...`,
        extra: {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "🎰 Girar Roleta", callback_data: `spin2_${chosen}` }]],
          },
        },
      }, rand(700, 1300));
      return;
    }

    // ── Girar round 1 — SEMPRE PERDE ────────────────────────────────────────
    const s1 = data.match(/^spin1_(\d+)$/);
    if (s1) {
      const chosen = parseInt(s1[1]);
      let fell = rand(1, 10);
      while (fell === chosen) fell = rand(1, 10); // garante número diferente

      await enqueue("SEND_MESSAGE", chatId, {
        text: `Quase... caiu o <b>${fell}</b> 😔\n\nNão foi dessa vez... mas você ainda tem uma última chance.\n\nQuer tentar de novo?`,
        extra: {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Quero tentar novamente 🔥", callback_data: "tentar_roleta_2" }],
              [{ text: "Desistir",                   callback_data: "desistir"         }],
            ],
          },
        },
      }, rand(2000, 3200)); // delay maior pra criar suspense
      return;
    }

    // ── Girar round 2 — SEMPRE GANHA ────────────────────────────────────────
    const s2 = data.match(/^spin2_(\d+)$/);
    if (s2) {
      await enqueue("SEND_MESSAGE", chatId, {
        text: "🔥🔥 PORRA KKKKKK VC É MUITO SORTUDO CARALHO!! 🔥🔥\n\nDessa vez caiu o seu número!!\n\nAcabei de liberar o acesso pro meu privado.\n\nClica no botão abaixo e entra agora no meu privado pra me ver peladinha na chamada de vídeo 😈💦",
        extra: {
          reply_markup: {
            inline_keyboard: [[{
              text: "🚀 ENTRAR NO MINI APP AGORA",
              web_app: { url: process.env.WEBAPP_URL },
            }]],
          },
        },
      }, rand(2000, 3200));
      await setEtapa(chatId, "webapp_pending");
      return;
    }

    // ── Desistir ─────────────────────────────────────────────────────────────
    if (data === "desistir") {
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Ah que pena... Se mudar de ideia é só me chamar 😈",
      }, rand(700, 1300));
      return;
    }

    // ── Seleção de plano (vindo do checkout) ─────────────────────────────────
    if (data.startsWith("plan:")) {
      const plano = data.split(":")[1];
      await createCheckoutAndSend(chatId, plano);
      return;
    }

    // ── Webapp later ─────────────────────────────────────────────────────────
    if (data === "webapp:later") {
      await setEtapa(chatId, "start");
      await enqueue("SEND_MESSAGE", chatId, {
        text: "tá… quando quiser, volta aqui.",
        autoSplit: true,
      }, rand(900, 1600));
      return;
    }

  } catch (e) {
    console.error("callback error:", e);
  }
});

// =============================================================================
// web_app_data — fallback quando mini app usa sendData()
// =============================================================================
bot.on("web_app_data", async (msg) => {
  const chatId = msg.chat.id;
  let payload = {};
  try { payload = JSON.parse(msg.web_app_data.data); } catch {}
  console.log("[web_app_data] chatId:", chatId, "payload:", payload);
  // checkout é tratado via api/checkout.js (serverless)
});

console.log("bot v4 — fluxo roleta rodando...");
