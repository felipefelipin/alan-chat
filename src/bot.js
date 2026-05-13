// src/bot.js
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { mpCreatePix } = require("../payments/mp");

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// helper: BullMQ nessa versão não aceita ":" em jobId
const jid = (...parts) => parts.join("-");

function pickEchoWord(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const stop = new Set([
    "oi", "ola", "olá", "sim", "nao", "não",
    "to", "tô", "ta", "tá", "ok", "blz",
  ]);

  const cand = t.filter((w) => w.length >= 3 && w.length <= 10 && !stop.has(w));
  return cand[0] || null;
}

async function upsertUser(chatId) {
  return prisma.user.upsert({
    where:  { id: String(chatId) },
    update: { etapa: "engajado" },
    create: { id: String(chatId), etapa: "engajado", pagou: false },
  });
}

async function setEtapa(chatId, etapa) {
  await prisma.user.update({ where: { id: String(chatId) }, data: { etapa } });
}

async function schedulePreNudge(chatId) {
  const delay = rand(60_000, 120_000);
  await queue.add(
    "jobs",
    { type: "PRE_NUDGE", chatId: String(chatId), data: {} },
    { delay, jobId: jid("pre_nudge", chatId), removeOnComplete: true, removeOnFail: true }
  );
}

async function cancelPreNudge(chatId) {
  try {
    const job = await queue.getJob(jid("pre_nudge", chatId));
    if (job) await job.remove();
  } catch {}
}

/**
 * CHECKOUT PLANS (fallback via web_app_data)
 */
async function scheduleRemarketingJobs(chatId, etapa) {
  const base = `rmkt-${etapa}-${chatId}`;
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "10m", etapa } },
    { delay: 10 * 60 * 1000, jobId: `${base}-10m`, removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "1h", etapa } },
    { delay: 60 * 60 * 1000, jobId: `${base}-1h`, removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "24h", etapa } },
    { delay: 24 * 60 * 60 * 1000, jobId: `${base}-24h`, removeOnComplete: true, removeOnFail: true }
  );
}

async function sendPlans(chatId) {
  await setEtapa(chatId, "checkout");
  await queue.add("jobs",
    { type: "SEND_PLANS", chatId: String(chatId), data: {} },
    { removeOnComplete: true, removeOnFail: true }
  );
}

async function createCheckoutAndSend(chatId, plano) {
  const { paymentId, pixCode, pixQrBase64, amount } = await mpCreatePix({ chatId, plano });

  await prisma.payment.create({
    data: { userId: String(chatId), plano, status: "pending", preferenceId: paymentId, initPoint: pixCode },
  });

  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "boa.", autoSplit: true } },
    { delay: rand(1200, 2000), removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "gerou seu Pix aqui...", autoSplit: true } },
    { delay: rand(2800, 4000), removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "SEND_PIX", chatId: String(chatId), data: { pixCode, pixQrBase64, amount } },
    { delay: rand(4500, 6000), removeOnComplete: true, removeOnFail: true }
  );

  await setEtapa(chatId, "pagamento");
  await scheduleRemarketingJobs(chatId, "pagamento");
}

// =============================================================================
// /start — dispara o novo funil (FUNNEL_START no worker)
// =============================================================================
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await upsertUser(chatId);
  await cancelPreNudge(chatId);
  await schedulePreNudge(chatId);
  await queue.add("jobs",
    { type: "FUNNEL_START", chatId: String(chatId), data: {} },
    { jobId: jid("funnel_start", chatId), removeOnComplete: true, removeOnFail: true }
  );
});

// =============================================================================
// Mensagem de texto livre (usuário em etapa "engajado")
// =============================================================================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && msg.text.startsWith("/")) return;

  const user = await prisma.user.findUnique({ where: { id: String(chatId) } });
  if (!user) return;
  if (user.etapa !== "engajado") return;

  const echoWord = pickEchoWord(msg.text);
  await cancelPreNudge(chatId);

  let total = 0;
  let idx = 0;

  total += rand(900, 1600); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "ok…", autoSplit: true, echoWord } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1800, 2800); idx += 1;
  await queue.add("jobs",
    { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "intro.mp4", caption: "", autoDeleteMs: 5000 } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1600, 2600); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "meu bem, vou te levar pra um lugar mais exclusivo", autoSplit: true } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1500, 2400); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "pra vc poder ver melhor…", autoSplit: true } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1600, 2400); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "entra no privado comigo 🔒", autoSplit: true } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1200, 2000); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: {
      text: "👇",
      autoSplit: false,
      extra: { reply_markup: { inline_keyboard: [
        [{ text: "ENTRAR NO PRIVADO 🔒", web_app: { url: process.env.WEBAPP_URL + "?v=" + Date.now() } }],
        [{ text: "FICAR POR AQUI",       callback_data: "webapp:later" }],
      ]}},
    }},
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1600, 2400); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "entra aqui comigo", autoSplit: true } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1400, 2300); idx += 1;
  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "vai ser rapidinho…", autoSplit: true, allowHumanError: true } },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  await setEtapa(chatId, "webapp_pending");
});

// =============================================================================
// web_app_data — mini app envia action=checkout
// =============================================================================
bot.on("web_app_data", async (msg) => {
  const chatId = msg.chat.id;
  await cancelPreNudge(chatId);

  let payload = null;
  try { payload = JSON.parse(msg.web_app_data.data); }
  catch { payload = { action: msg.web_app_data.data }; }

  if (payload?.action === "checkout") {
    await sendPlans(chatId);
  }
});

// =============================================================================
// Callbacks
// =============================================================================
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data   = q.data;
  if (!chatId || !data) return;

  try {
    // ── Funil roleta — passo 1 → 2 ─────────────────────────────────────────
    if (["start_sim", "start_otimo", "start_afim"].includes(data)) {
      await bot.answerCallbackQuery(q.id, { text: "boa… 😈" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_STEP2", chatId: String(chatId), data: {} },
        { delay: rand(150, 300), jobId: jid("step2", chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Funil roleta — passo 2 → intro roleta ──────────────────────────────
    if (["quero_video", "mostra_primeiro"].includes(data)) {
      await bot.answerCallbackQuery(q.id, { text: "vem ver… 🔥" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_ROLETA_INTRO", chatId: String(chatId), data: {} },
        { delay: rand(150, 300), jobId: jid("roleta_intro", chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Grade numérica round 1 ──────────────────────────────────────────────
    if (data === "tentar_roleta_1") {
      await bot.answerCallbackQuery(q.id, { text: "girando… 🎰" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_NUM_GRID", chatId: String(chatId), data: { round: 1 } },
        { delay: rand(100, 250), jobId: jid("num_grid", 1, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Grade numérica round 2 ──────────────────────────────────────────────
    if (data === "tentar_roleta_2") {
      await bot.answerCallbackQuery(q.id, { text: "última chance… 🎰" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_NUM_GRID", chatId: String(chatId), data: { round: 2 } },
        { delay: rand(100, 250), jobId: jid("num_grid", 2, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Número escolhido round 1 ────────────────────────────────────────────
    const m1 = data.match(/^num1_(\d+)$/);
    if (m1) {
      await bot.answerCallbackQuery(q.id, { text: "boa escolha 👀" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_NUM_CHOSEN", chatId: String(chatId), data: { round: 1, chosen: parseInt(m1[1]) } },
        { delay: rand(100, 250), jobId: jid("num_chosen", 1, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Número escolhido round 2 ────────────────────────────────────────────
    const m2 = data.match(/^num2_(\d+)$/);
    if (m2) {
      await bot.answerCallbackQuery(q.id, { text: "boa escolha 👀" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_NUM_CHOSEN", chatId: String(chatId), data: { round: 2, chosen: parseInt(m2[1]) } },
        { delay: rand(100, 250), jobId: jid("num_chosen", 2, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Girar round 1 ──────────────────────────────────────────────────────
    const s1 = data.match(/^spin1_(\d+)$/);
    if (s1) {
      await bot.answerCallbackQuery(q.id, { text: "vai… 🎰" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_SPIN", chatId: String(chatId), data: { round: 1, chosen: parseInt(s1[1]) } },
        { delay: rand(100, 200), jobId: jid("spin", 1, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Girar round 2 ──────────────────────────────────────────────────────
    const s2 = data.match(/^spin2_(\d+)$/);
    if (s2) {
      await bot.answerCallbackQuery(q.id, { text: "vai… 🎰" }).catch(() => {});
      await cancelPreNudge(chatId);
      await queue.add("jobs",
        { type: "FUNNEL_SPIN", chatId: String(chatId), data: { round: 2, chosen: parseInt(s2[1]) } },
        { delay: rand(100, 200), jobId: jid("spin", 2, chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Desistir ────────────────────────────────────────────────────────────
    if (data === "desistir") {
      await bot.answerCallbackQuery(q.id, { text: "tá bom…" }).catch(() => {});
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "Ah que pena... Se mudar de ideia é só me chamar 😈" } },
        { delay: rand(300, 600), jobId: jid("desistir", chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── webapp:later (original) ─────────────────────────────────────────────
    if (data === "webapp:later") {
      await bot.answerCallbackQuery(q.id, { text: "tá…" });
      await setEtapa(chatId, "engajado");
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "tá… quando quiser, volta aqui.", autoSplit: true } },
        { delay: rand(900, 1600), jobId: jid("webapp_later", chatId), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Seleção de plano (original) ─────────────────────────────────────────
    if (data.startsWith("plan:")) {
      await bot.answerCallbackQuery(q.id, { text: "ok." });
      await createCheckoutAndSend(chatId, data.split(":")[1]);
      return;
    }

  } catch (e) {
    console.error("callback error:", e);
    try { await bot.answerCallbackQuery(q.id, { text: "deu ruim aqui. tenta de novo." }); } catch {}
  }
});

console.log("bot v4 rodando...");
