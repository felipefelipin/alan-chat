// src/worker.js
require("dotenv").config();

const { Worker } = require("bullmq");
const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { connection } = require("./queue");

const prisma = new PrismaClient({ log: ["error", "warn"] });

// worker só envia msg (NÃO faz polling)
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function jitter(ms, pct = 0.18) {
  const j = Math.floor(ms * pct);
  return Math.max(0, ms + rand(-j, j));
}

function calcDelayFromText(text) {
  const t = String(text || "");
  const base = Math.min(5200, Math.max(1100, t.length * 46));
  return jitter(base);
}

// ===============================
// ✅ LOCK POR CHAT (anti-desordem)
// ===============================
const chatLocks = new Map();
/**
 * Garante que jobs do mesmo chatId rodem em série, mesmo com concurrency alto.
 */
function withChatLock(chatId, fn) {
  const key = String(chatId);
  const prev = chatLocks.get(key) || Promise.resolve();

  const next = prev
    .catch(() => {}) // não propaga erro anterior
    .then(fn)
    .finally(() => {
      if (chatLocks.get(key) === next) chatLocks.delete(key);
    });

  chatLocks.set(key, next);
  return next;
}

// ===============================
// typing humano (bursts)
// ===============================
async function typingBursts(chatId, msTotal) {
  const bursts = Math.max(1, Math.min(5, Math.round(msTotal / 650)));
  const slice = Math.max(240, Math.floor(msTotal / bursts));

  for (let i = 0; i < bursts; i++) {
    try {
      await bot.sendChatAction(chatId, "typing");
    } catch {}
    await sleep(jitter(slice, 0.25));
  }
}

function autoSplitText(text) {
  const t = String(text || "").trim();
  if (!t) return [];

  if (t.includes(" | ")) return t.split(" | ").map((s) => s.trim()).filter(Boolean);
  if (t.includes("\n")) return t.split("\n").map((s) => s.trim()).filter(Boolean);

  const rough = t
    .replace(/\s+/g, " ")
    .split(/(?<=[\.\?\!…])\s+|(?<=,)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  for (const part of rough) {
    if (part.length <= 56) {
      out.push(part);
      continue;
    }
    const words = part.split(" ");
    let buf = "";
    for (const w of words) {
      if ((buf + " " + w).trim().length > 56) {
        out.push(buf.trim());
        buf = w;
      } else {
        buf = (buf + " " + w).trim();
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

async function maybeHumanError(chatId, text) {
  if (Math.random() > 0.03) return null; // raro
  const t = String(text || "");
  if (t.length < 10) return null;

  const idx = rand(2, Math.min(t.length - 2, 12));
  const wrong = t.slice(0, idx) + (t[idx] === " " ? "" : t[idx] + t[idx]) + t.slice(idx + 1);

  const sent = await bot.sendMessage(chatId, wrong);
  await sleep(jitter(rand(650, 1200)));

  try {
    await bot.deleteMessage(chatId, String(sent.message_id));
  } catch {}

  await sleep(jitter(rand(250, 650)));
  return bot.sendMessage(chatId, t);
}

async function sendHuman(chatId, text, extra = {}, opts = {}) {
  const { delayMs, autoSplit = false, echoWord, allowHumanError = false } = opts;

  let finalText = String(text || "").trim();
  if (!finalText && !extra?.reply_markup) return; // nada pra enviar

  // eco opcional
  if (echoWord) {
    const ew = String(echoWord).trim();
    if (ew) finalText = `${ew}… ${finalText}`;
  }

  // se for mensagem “só com botão”, manda direto com um micro-typing
  if (!finalText && extra?.reply_markup) {
    await typingBursts(chatId, jitter(rand(650, 1200)));
    await sleep(jitter(rand(80, 180)));
    await bot.sendMessage(chatId, " ", extra || {});
    return;
  }

  const parts = autoSplit ? autoSplitText(finalText) : [finalText];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    const ms = typeof delayMs === "number" ? delayMs : calcDelayFromText(part);
    await typingBursts(chatId, ms);
    await sleep(jitter(rand(90, 220)));

    if (allowHumanError && part.length <= 64) {
      const did = await maybeHumanError(chatId, part);
      if (did) {
        if (i < parts.length - 1) await sleep(jitter(rand(420, 900)));
        continue;
      }
    }

    await bot.sendMessage(chatId, part, extra || {});
    if (i < parts.length - 1) await sleep(jitter(rand(420, 900)));
  }
}

// ===============================
// ✅ MÍDIA VIA URL (DEFINITIVO)
// ===============================
const ASSETS_BASE =
  (process.env.PUBLIC_ASSETS_BASE || "").trim().replace(/\/+$/, "") || "https://alana-chat.vercel.app/assets";

function assetUrl(file) {
  // garante sem barras duplicadas
  const f = String(file || "").replace(/^\/+/, "");
  return `${ASSETS_BASE}/${encodeURIComponent(f)}`.replace(/%2F/g, "/");
}

async function sendPhotoWithAction(chatId, file, caption = "") {
  try {
    await bot.sendChatAction(chatId, "upload_photo");
  } catch {}
  await sleep(jitter(rand(900, 1700)));

  const url = assetUrl(file);
  // Telegram aceita URL direta
  await bot.sendPhoto(chatId, url, caption ? { caption } : {});
}

async function sendVideoWithAction(chatId, file, opts = {}) {
  const { caption = "", autoDeleteMs } = opts;

  try {
    await bot.sendChatAction(chatId, "upload_video");
  } catch {}
  await sleep(jitter(rand(1100, 2100)));

  const url = assetUrl(file);

  const sent = await bot.sendVideo(chatId, url, caption ? { caption } : {});

  if (autoDeleteMs) {
    setTimeout(() => {
      bot.deleteMessage(chatId, String(sent.message_id)).catch(() => {});
    }, autoDeleteMs);
  }
}

async function logEventSafe(chatId, type, payload) {
  try {
    await prisma.event.create({
      data: {
        userId: String(chatId),
        type,
        payload,
      },
    });
  } catch (e) {
    console.error("event.create failed (ignored):", e.message);
  }
}

async function boot() {
  try {
    await prisma.$connect();
    console.log("[worker] prisma connected ✅");
  } catch (e) {
    console.error("[worker] prisma connect failed ❌", e);
    process.exit(1);
  }
}
boot();

const worker = new Worker(
  "jobs",
  async (job) => {
    const { type, chatId, data } = job.data || {};
    if (!type || !chatId) return;

    return withChatLock(chatId, async () => {
      console.log("JOB:", type, chatId);

      if (type === "SEND_MESSAGE") {
        const text = data?.text ?? "";
        const extra = data?.extra ?? {};
        const opts = {
          delayMs: typeof data?.delayMs === "number" ? data.delayMs : undefined,
          autoSplit: !!data?.autoSplit,
          echoWord: data?.echoWord,
          allowHumanError: !!data?.allowHumanError,
        };

        await sendHuman(chatId, text, extra, opts);
        await logEventSafe(chatId, "SEND_MESSAGE", { text, opts, hasButtons: !!extra?.reply_markup });
        return;
      }

      if (type === "SEND_PHOTO") {
        const file = data?.file || "intro.jpg";
        const caption = data?.caption || "";
        await sendPhotoWithAction(chatId, file, caption);
        await logEventSafe(chatId, "SEND_PHOTO", { file, via: "url", base: ASSETS_BASE });
        return;
      }

      if (type === "SEND_VIDEO") {
        const file = data?.file || "intro.mp4";
        const caption = data?.caption || "";
        const autoDeleteMs = data?.autoDeleteMs;
        await sendVideoWithAction(chatId, file, { caption, autoDeleteMs });
        await logEventSafe(chatId, "SEND_VIDEO", { file, autoDeleteMs, via: "url", base: ASSETS_BASE });
        return;
      }

      if (type === "SEND_PLANS") {
        await prisma.user.update({ where: { id: String(chatId) }, data: { etapa: "checkout" } }).catch(() => {});

        await sendHuman(chatId, "tá… agora escolhe como você quer entrar.", {}, { autoSplit: true });
        await sleep(jitter(rand(1000, 1800)));
        await sendHuman(chatId, "3 opções. sem enrolar.", {}, { autoSplit: true });
        await sleep(jitter(rand(800, 1400)));

        await bot.sendMessage(chatId, "👇", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 ACESSO AO VIVO — R$ 29,90",       callback_data: "plan:basic" }],
              [{ text: "💎 PREMIUM — R$ 49,90 🔥",            callback_data: "plan:plus"  }],
              [{ text: "👑 VIP TOTAL — R$ 97,00",             callback_data: "plan:vip"   }],
            ],
          },
        });

        await logEventSafe(chatId, "SEND_PLANS", {});
        return;
      }

      if (type === "PRE_NUDGE") {
        const user = await prisma.user.findUnique({ where: { id: String(chatId) } });
        if (!user) return;
        if (user.pagou) return;
        if (user.etapa !== "webapp_pending") return;

        await sendHuman(chatId, "você travou?", {}, { autoSplit: true });
        await sendHuman(chatId, "eu não vou deixar isso aberto por muito tempo.", {}, { autoSplit: true });

        await logEventSafe(chatId, "PRE_NUDGE_SENT", {});
        return;
      }

      if (type === "REMARKETING") {
        const user = await prisma.user.findUnique({ where: { id: String(chatId) } });
        if (!user) return;
        if (user.pagou) return;
        if (user.etapa !== "pagamento") return;

        const stage = data?.stage;
        if (stage === "10m") {
          await sendHuman(chatId, "você sumiu…", {}, { autoSplit: true });
          await sendHuman(chatId, "ficou com medo?", {}, { autoSplit: true });
        } else if (stage === "1h") {
          await sendHuman(chatId, "eu quase fechei aquilo pra você", {}, { autoSplit: true });
        } else if (stage === "24h") {
          await sendHuman(chatId, "última vez que vou te chamar aqui…", {}, { autoSplit: true });
        }

        await logEventSafe(chatId, "REMARKETING_SENT", { stage });
        return;
      }

      if (type === "POST_PAYMENT") {
        await prisma.user.update({
          where: { id: String(chatId) },
          data: { pagou: true, etapa: "pos_pagamento" },
        });

        await sendHuman(chatId, "agora sim…", {}, { autoSplit: false });
        await sendHuman(chatId, "você entrou de verdade", {}, { autoSplit: true });
        await sendHuman(chatId, "não sai daqui", {}, { autoSplit: true });
        await sendHuman(chatId, "eu vou continuar de onde parei…", {}, { autoSplit: true });

        await logEventSafe(chatId, "POST_PAYMENT_DELIVERED", {});
        return;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // FUNIL ROLETA — /start flow
      // ═══════════════════════════════════════════════════════════════════════

      if (type === "FUNNEL_START") {
        await sendPhotoWithAction(chatId, "intro.jpg");
        await sleep(rand(400, 700));
        await bot.sendMessage(chatId,
          "Oi gato 😈\n\nAcabei de acordar toda molhada pensando em um homem de verdade...\n\nTá tudo bem por aí?",
          { reply_markup: { inline_keyboard: [
            [{ text: "Tô bem 🔥",            callback_data: "start_sim"   }],
            [{ text: "Tô ótimo, e você? 😏",  callback_data: "start_otimo" }],
            [{ text: "Tô afim de você 💦",    callback_data: "start_afim"  }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_START", {});
        return;
      }

      if (type === "FUNNEL_STEP2") {
        await bot.sendMessage(chatId,
          "Que bom... Eu também tô bem, mas bem safadinha hoje 👀💦\n\nSabe, eu só faço chamada de vídeo peladinha pra quem realmente me excita de verdade...\n\nTopa uma chamada bem gostosa e sem censura comigo agora?",
          { reply_markup: { inline_keyboard: [
            [{ text: "Quero sim 😈",           callback_data: "quero_video"     }],
            [{ text: "Tô afim pra caralho 🔥", callback_data: "quero_video"     }],
            [{ text: "Me mostra primeiro",      callback_data: "mostra_primeiro" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_STEP2", {});
        return;
      }

      if (type === "FUNNEL_ROLETA_INTRO") {
        await bot.sendMessage(chatId,
          "Perfeito 😏\n\nMas pra me ver toda peladinha, e me ter bem putinha em um privado bem secreto, a gente vai ter que brincar de roleta da sorte.\n\nQuer tentar a sorte?",
          { reply_markup: { inline_keyboard: [
            [{ text: "Quero tentar a sorte 🎰",   callback_data: "tentar_roleta_1" }],
            [{ text: "Tô com muita sorte hoje 😈", callback_data: "tentar_roleta_1" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_ROLETA_INTRO", {});
        return;
      }

      if (type === "FUNNEL_NUM_GRID") {
        const round  = data?.round ?? 1;
        const label  = round === 2 ? "Última chance! Escolhe seu número de 1 a 10:" : "Escolhe um número de 1 a 10:";
        const numRow = (nums) => nums.map(n => ({ text: String(n), callback_data: `num${round}_${n}` }));
        await bot.sendMessage(chatId, label, {
          reply_markup: { inline_keyboard: [ numRow([1,2,3,4,5]), numRow([6,7,8,9,10]) ] },
        });
        await logEventSafe(chatId, "FUNNEL_NUM_GRID", { round });
        return;
      }

      if (type === "FUNNEL_NUM_CHOSEN") {
        const round  = data?.round  ?? 1;
        const chosen = data?.chosen ?? 1;
        await bot.sendMessage(chatId,
          `Beleza! Escolheu o <b>${chosen}</b>.\n\nVou girar a roleta...`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard: [
            [{ text: "🎰 Girar Roleta", callback_data: `spin${round}_${chosen}` }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_NUM_CHOSEN", { round, chosen });
        return;
      }

      if (type === "FUNNEL_SPIN") {
        const round  = data?.round  ?? 1;
        const chosen = data?.chosen ?? 1;

        // 🎰 Roleta real nativa do Telegram
        await bot.sendDice(chatId, { emoji: "🎰" });
        await sleep(4000); // aguarda a animação terminar

        if (round === 1) {
          let fell = rand(1, 10);
          while (fell === chosen) fell = rand(1, 10);
          await bot.sendMessage(chatId,
            `Quase... caiu o <b>${fell}</b> 😔\n\nNão foi dessa vez... mas você ainda tem uma última chance.\n\nQuer tentar de novo?`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [
              [{ text: "Quero tentar novamente 🔥", callback_data: "tentar_roleta_2" }],
              [{ text: "Desistir",                   callback_data: "desistir"         }],
            ]}}
          );
        } else {
          await bot.sendMessage(chatId,
            "🔥🔥 PORRA KKKKKK VC É MUITO SORTUDO CARALHO!! 🔥🔥\n\nDessa vez caiu o seu número!!\n\nAcabei de liberar o acesso pro meu privado.\n\nClica no botão abaixo e entra agora no meu privado pra me ver peladinha na chamada de vídeo 😈💦",
            { reply_markup: { inline_keyboard: [[{
              text: "🚀 ENTRAR NO MINI APP AGORA",
              web_app: { url: process.env.WEBAPP_URL },
            }]]}}
          );
          await prisma.user.update({
            where: { id: String(chatId) },
            data:  { etapa: "webapp_pending" },
          }).catch(() => {});
        }

        await logEventSafe(chatId, "FUNNEL_SPIN", { round, chosen });
        return;
      }

    });
  },
  {
    connection,
    concurrency: 10,
  }
);

worker.on("completed", (job) => console.log(`job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err?.message || err));

process.on("SIGINT", async () => {
  console.log("[worker] shutting down...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

console.log("worker v3 FINAL (chat-lock) rodando...");