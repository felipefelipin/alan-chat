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

function enqueue(type, chatId, data, delay = 0, jobId) {
  const opts = { delay, removeOnComplete: true, removeOnFail: true };
  if (jobId) opts.jobId = jobId;
  return queue.add("jobs", { type, chatId: String(chatId), data }, opts);
}

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
// /start — dispara o funil
// =============================================================================
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await upsertUser(chatId);
  await setEtapa(chatId, "start");
  await enqueue("FUNNEL_START", chatId, {}, rand(400, 900), jid("funnel_start", chatId));
});

// =============================================================================
// Callbacks inline
// =============================================================================
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data   = q.data || "";
  if (!chatId || !data) return;

  await bot.answerCallbackQuery(q.id).catch(() => {});

  try {
    // ── Passo 1 → 2 ────────────────────────────────────────────────────────
    if (["start_sim", "start_otimo", "start_afim"].includes(data)) {
      await enqueue("FUNNEL_STEP2", chatId, {}, rand(600, 1200));
      return;
    }

    // ── Passo 2 → roleta intro ──────────────────────────────────────────────
    if (["quero_video", "mostra_primeiro"].includes(data)) {
      await enqueue("FUNNEL_ROLETA_INTRO", chatId, {}, rand(600, 1200));
      return;
    }

    // ── Grade numérica round 1 ──────────────────────────────────────────────
    if (data === "tentar_roleta_1") {
      await enqueue("FUNNEL_NUM_GRID", chatId, { round: 1 }, rand(400, 900));
      return;
    }

    // ── Grade numérica round 2 ──────────────────────────────────────────────
    if (data === "tentar_roleta_2") {
      await enqueue("FUNNEL_NUM_GRID", chatId, { round: 2 }, rand(400, 900));
      return;
    }

    // ── Número escolhido round 1 ────────────────────────────────────────────
    const m1 = data.match(/^num1_(\d+)$/);
    if (m1) {
      await enqueue("FUNNEL_NUM_CHOSEN", chatId, { round: 1, chosen: parseInt(m1[1]) }, rand(500, 1000));
      return;
    }

    // ── Número escolhido round 2 ────────────────────────────────────────────
    const m2 = data.match(/^num2_(\d+)$/);
    if (m2) {
      await enqueue("FUNNEL_NUM_CHOSEN", chatId, { round: 2, chosen: parseInt(m2[1]) }, rand(500, 1000));
      return;
    }

    // ── Girar round 1 ──────────────────────────────────────────────────────
    const s1 = data.match(/^spin1_(\d+)$/);
    if (s1) {
      await enqueue("FUNNEL_SPIN", chatId, { round: 1, chosen: parseInt(s1[1]) }, rand(400, 800));
      return;
    }

    // ── Girar round 2 ──────────────────────────────────────────────────────
    const s2 = data.match(/^spin2_(\d+)$/);
    if (s2) {
      await enqueue("FUNNEL_SPIN", chatId, { round: 2, chosen: parseInt(s2[1]) }, rand(400, 800));
      return;
    }

    // ── Desistir ────────────────────────────────────────────────────────────
    if (data === "desistir") {
      await enqueue("SEND_MESSAGE", chatId, {
        text: "Ah que pena... Se mudar de ideia é só me chamar 😈",
      }, rand(700, 1300));
      return;
    }

    // ── Seleção de plano ────────────────────────────────────────────────────
    if (data.startsWith("plan:")) {
      await createCheckoutAndSend(chatId, data.split(":")[1]);
      return;
    }

    // ── Webapp later ────────────────────────────────────────────────────────
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
// web_app_data — mini app envia action=checkout
// =============================================================================
bot.on("web_app_data", async (msg) => {
  const chatId = msg.chat.id;
  let payload = {};
  try { payload = JSON.parse(msg.web_app_data.data); } catch {}
  // checkout tratado via api/checkout.js (serverless)
  console.log("[web_app_data]", chatId, payload);
});

console.log("bot v4 rodando...");
