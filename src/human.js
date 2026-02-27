// src/worker.js
require("dotenv").config();

const { Worker } = require("bullmq");
const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { connection } = require("./queue");

// IMPORT CERTO (human dentro de src/)
const { humanTyping, humanWait } = require("./human");

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

async function safeEventCreate(data) {
  try {
    await prisma.event.create({ data });
  } catch (err) {
    console.error("EVENT LOG ERROR (ignored):", err?.message || err);
  }
}

function splitHuman(text, maxLen = 62) {
  const t = String(text || "").trim();
  if (!t) return [];

  const lines = t.split("\n").map(s => s.trim()).filter(Boolean);
  const parts = [];

  for (const line of lines) {
    if (line.length <= maxLen) {
      parts.push(line);
      continue;
    }
    const chunks = line
      .split(/(?<=[\.\!\?\…])\s+/g)
      .map(s => s.trim())
      .filter(Boolean);

    for (const c of chunks) {
      if (c.length <= maxLen) parts.push(c);
      else {
        let i = 0;
        while (i < c.length) {
          parts.push(c.slice(i, i + maxLen).trim());
          i += maxLen;
        }
      }
    }
  }

  return parts.filter(Boolean);
}

async function sendThenDelete(chatId, wrongText) {
  try {
    const m = await bot.sendMessage(chatId, wrongText);
    await humanWait(chatId, 650);
    await bot.deleteMessage(chatId, m.message_id);
    return true;
  } catch {
    return false;
  }
}

async function humanSend(chatId, text, opts = {}) {
  const parts = splitHuman(text, opts.maxLen || 62);
  if (!parts.length) return;

  // eco opcional
  if (opts.echoWord) {
    await humanTyping(bot, chatId, `${String(opts.echoWord).toLowerCase()} então…`, { emotionalPause: true });
    await humanWait(chatId, 650);
  }

  // erro humano (opcional)
  const doError =
    opts.allowError ||
    (Math.random() < (opts.errorChance ?? 0.12) && parts[0].length <= 18);

  if (doError) {
    const wrong = parts[0];
    const fixed = wrong.endsWith(".") ? wrong.replace(/\.$/, "…") : `${wrong}…`;
    if (wrong !== fixed) {
      const deleted = await sendThenDelete(chatId, wrong);
      await humanWait(chatId, deleted ? 280 : 180);
      await humanTyping(bot, chatId, fixed, { emotionalPause: true });

      for (let i = 1; i < parts.length; i++) {
        await humanWait(chatId, 520);
        await humanTyping(bot, chatId, parts[i]);
      }
      return;
    }
  }

  // envio normal
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await humanWait(chatId, 520);
    await humanTyping(bot, chatId, parts[i], { emotionalPause: i === 0 && parts.length > 1 });
  }
}

const worker = new Worker(
  "jobs",
  async (job) => {
    const { type, chatId, data } = job.data;

    console.log("JOB:", type, chatId); // <-- se isso não aparecer, o worker não está pegando a fila

    if (type === "SEND_MESSAGE") {
      await humanSend(chatId, data?.text || "", data || {});
      await safeEventCreate({
        userId: String(chatId),
        type: "SEND_MESSAGE",
        payload: data || {},
      });
      return;
    }

    if (type === "PRE_NUDGE") {
      // se quiser condicionar por etapa no DB, reativa aqui
      // const u = await prisma.user.findUnique({ where: { id: String(chatId) } });
      // if (!u || u.etapa !== "webapp") return;

      await humanSend(chatId, "você travou?", { errorChance: 0.08 });
      await humanWait(chatId, 850);
      await humanSend(chatId, "eu não vou deixar isso aberto por muito tempo.", { errorChance: 0.0 });

      await safeEventCreate({
        userId: String(chatId),
        type: "PRE_NUDGE_SENT",
      });
      return;
    }

    if (type === "POST_PAYMENT") {
      // opcional humanizar também
      await humanSend(chatId, "agora sim…", { errorChance: 0.05 });
      await humanWait(chatId, 650);
      await humanSend(chatId, "você entrou de verdade.", { errorChance: 0.0 });

      await safeEventCreate({
        userId: String(chatId),
        type: "POST_PAYMENT_DELIVERED",
      });
      return;
    }
  },
  { connection, concurrency: 5 }
);

worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err?.message || err));
console.log("worker v3 humanizado rodando…");