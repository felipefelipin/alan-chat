// src/bot.js
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { mpCreatePreference } = require("../payments/mp");

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
    "oi",
    "ola",
    "olá",
    "sim",
    "nao",
    "não",
    "to",
    "tô",
    "ta",
    "tá",
    "ok",
    "blz",
  ]);

  const cand = t.filter((w) => w.length >= 3 && w.length <= 10 && !stop.has(w));
  return cand[0] || null;
}

async function upsertUser(chatId) {
  return prisma.user.upsert({
    where: { id: String(chatId) },
    update: {},
    create: {
      id: String(chatId),
      etapa: "engajado",
      pagou: false,
    },
  });
}

async function setEtapa(chatId, etapa) {
  await prisma.user.update({
    where: { id: String(chatId) },
    data: { etapa },
  });
}

async function schedulePreNudge(chatId) {
  const delay = rand(60_000, 120_000);
  await queue.add(
    "jobs",
    { type: "PRE_NUDGE", chatId: String(chatId), data: {} },
    {
      delay,
      jobId: jid("pre_nudge", chatId),
      removeOnComplete: true,
      removeOnFail: true,
    }
  );
}

async function cancelPreNudge(chatId) {
  try {
    const job = await queue.getJob(jid("pre_nudge", chatId));
    if (job) await job.remove();
  } catch {}
}

/**
 * START SCRIPT (com foto antes do "ei…")
 */
async function sendStartScript(chatId) {
  await setEtapa(chatId, "engajado");
  await cancelPreNudge(chatId);
  await schedulePreNudge(chatId);

  let total = 0;
  let idx = 0;

  // ✅ FOTO LOCAL (assets/intro.jpg) ANTES DO “ei…”
  total += rand(700, 1400);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_PHOTO",
      chatId: String(chatId),
      data: { caption: "" },
    },
    { delay: total, jobId: jid("start", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // ✅ timing mais humano (delays maiores)
  const script = [
    { text: "ei…", d: rand(1400, 2400) },
    { text: "eu sou a gisa.", d: rand(1800, 3000), allowHumanError: true },
    { text: "me dá 10s?", d: rand(1900, 3300) },
    { text: "eu te mostro uma coisa rapidinho.", d: rand(2200, 3800) },
  ];

  for (const s of script) {
    total += s.d;
    idx += 1;
    await queue.add(
      "jobs",
      {
        type: "SEND_MESSAGE",
        chatId: String(chatId),
        data: {
          text: s.text,
          autoSplit: true,
          allowHumanError: !!s.allowHumanError,
        },
      },
      { delay: total, jobId: jid("start", chatId, idx), removeOnComplete: true, removeOnFail: true }
    );
  }

  total += rand(2400, 4200);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: {
        text: "só me diz… você tá sozinho(a) agora?",
        autoSplit: true,
      },
    },
    { delay: total, jobId: jid("start", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );
}

/**
 * CHECKOUT PLANS
 */
async function sendPlans(chatId) {
  await setEtapa(chatId, "checkout");

  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "tá… agora escolhe como você quer entrar.", autoSplit: true },
    },
    { delay: rand(1200, 2100), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "3 jeitos. sem enrolar.", autoSplit: true },
    },
    { delay: rand(2600, 4200), removeOnComplete: true, removeOnFail: true }
  );

  const extra = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "basic", callback_data: "plan:basic" }],
        [{ text: "plus", callback_data: "plan:plus" }],
        [{ text: "vip", callback_data: "plan:vip" }],
      ],
    },
  };

  // ✅ nunca texto vazio (Telegram exige)
  await queue.add(
    "jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "👇", extra } },
    { delay: rand(4200, 5600), removeOnComplete: true, removeOnFail: true }
  );
}

async function createCheckoutAndSend(chatId, plano) {
  const { preferenceId, initPoint } = await mpCreatePreference({ chatId, plano });

  await prisma.payment.create({
    data: {
      userId: String(chatId),
      plano,
      status: "pending",
      preferenceId,
      initPoint,
    },
  });

  await queue.add(
    "jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: { text: "boa.", autoSplit: true } },
    { delay: rand(1200, 2000), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "paga aqui e volta pra mim.", autoSplit: true },
    },
    { delay: rand(2800, 4600), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: {
        text: "👇",
        extra: {
          reply_markup: { inline_keyboard: [[{ text: "💳 pagar agora", url: initPoint }]] },
        },
      },
    },
    { delay: rand(4600, 6200), removeOnComplete: true, removeOnFail: true }
  );

  await setEtapa(chatId, "pagamento");
}

/**
 * /start
 */
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await upsertUser(chatId);
  await sendStartScript(chatId);
});

/**
 * Resposta do usuário (ENGAJADO → vídeo + exclusividade + botões)
 */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // ignora comandos aqui (já tratado /start)
  if (msg.text && msg.text.startsWith("/")) return;

  const user = await prisma.user.findUnique({ where: { id: String(chatId) } });
  if (!user) return;

  // ✅ anti-bagunça: se já saiu de "engajado", não dispara o funil de novo
  if (user.etapa !== "engajado") return;

  const echoWord = pickEchoWord(msg.text);
  await cancelPreNudge(chatId);

  let total = 0;
  let idx = 0;

  // 1) ok…
  total += rand(900, 1600);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "ok…", autoSplit: true, echoWord },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // 2) vídeo no Telegram (autoDelete em 5s)
  total += rand(1800, 2800);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_VIDEO",
      chatId: String(chatId),
      data: {
        caption: "", // caption vazio ok
        autoDeleteMs: 5000,
      },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // 3) após apagar: textos
  total += rand(1600, 2600);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "meu bem, vou te levar pra um lugar mais exclusivo", autoSplit: true },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1500, 2400);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "pra vc poder ver melhor…", autoSplit: true },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // 4) call-to-action
  total += rand(1600, 2400);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "entra no privado comigo 🔒", autoSplit: true },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // 5) botões (✅ texto não-vazio)
  total += rand(1200, 2000);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: {
        text: "👇",
        autoSplit: false,
        extra: {
          reply_markup: {
            inline_keyboard: [
              [{ text: "ENTRAR NO PRIVADO 🔒", web_app: { url: process.env.WEBAPP_URL + "?v=" + Date.now() } }],
              [{ text: "FICAR POR AQUI", callback_data: "webapp:later" }],
            ],
          },
        },
      },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // 6) depois dos botões
  total += rand(1600, 2400);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "entra aqui comigo", autoSplit: true },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  total += rand(1400, 2300);
  idx += 1;
  await queue.add(
    "jobs",
    {
      type: "SEND_MESSAGE",
      chatId: String(chatId),
      data: { text: "vai ser rapidinho…", autoSplit: true, allowHumanError: true },
    },
    { delay: total, jobId: jid("webapp", chatId, idx), removeOnComplete: true, removeOnFail: true }
  );

  // ✅ etapa correta pro PRE_NUDGE funcionar
  await setEtapa(chatId, "webapp_pending");
});

/**
 * Recebe retorno do WebApp: action=checkout
 */
bot.on("web_app_data", async (msg) => {
  const chatId = msg.chat.id;

  await cancelPreNudge(chatId);

  let payload = null;
  try {
    payload = JSON.parse(msg.web_app_data.data);
  } catch {
    payload = { action: msg.web_app_data.data };
  }

  if (payload?.action === "checkout") {
    await sendPlans(chatId);
  }
});

/**
 * Callbacks
 */
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data = q.data;

  if (!chatId || !data) return;

  try {
    if (data === "webapp:later") {
      await bot.answerCallbackQuery(q.id, { text: "tá…" });

      // volta pro engajado, mas sem disparar fluxo sozinho
      await setEtapa(chatId, "engajado");

      await queue.add(
        "jobs",
        {
          type: "SEND_MESSAGE",
          chatId: String(chatId),
          data: { text: "tá… quando quiser, volta aqui.", autoSplit: true },
        },
        { delay: rand(900, 1600), removeOnComplete: true, removeOnFail: true }
      );

      return;
    }

    if (data.startsWith("plan:")) {
      const plano = data.split(":")[1];
      await bot.answerCallbackQuery(q.id, { text: "ok." });
      await createCheckoutAndSend(chatId, plano);
      return;
    }
  } catch (e) {
    console.error("callback error:", e);
    try {
      await bot.answerCallbackQuery(q.id, { text: "deu ruim aqui. tenta de novo." });
    } catch {}
  }
});

console.log("bot v3 pro rodando...");