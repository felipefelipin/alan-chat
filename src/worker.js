// src/worker.js
require("dotenv").config();

const fs   = require("fs");
const path = require("path");
const { Worker } = require("bullmq");
const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { connection, queue } = require("./queue");

const ASSETS_DIR = path.join(__dirname, "..", "public", "assets");

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

// ═══════════════════════════════════════════════════════════════════════
// CACHE DE file_id — após 1º upload o Telegram serve direto do CDN deles
// ═══════════════════════════════════════════════════════════════════════
const fileIdCache = new Map();

async function sendFunnelVideo(chatId, filename) {
  const cached = fileIdCache.get(filename);
  if (cached) {
    return bot.sendVideo(chatId, cached);
  }
  const stream = fs.createReadStream(path.join(ASSETS_DIR, filename));
  const sent = await bot.sendVideo(chatId, stream);
  const fid = sent?.video?.file_id;
  if (fid) fileIdCache.set(filename, fid);
  return sent;
}

async function sendFunnelPhoto(chatId, filename) {
  const cached = fileIdCache.get(filename);
  if (cached) {
    return bot.sendPhoto(chatId, cached);
  }
  const stream = fs.createReadStream(path.join(ASSETS_DIR, filename));
  const sent = await bot.sendPhoto(chatId, stream);
  const fid = sent?.photo?.at(-1)?.file_id;
  if (fid) fileIdCache.set(filename, fid);
  return sent;
}

// ═══════════════════════════════════════════════════════════════════════
// PROVA SOCIAL — nomes e mensagens aleatórias de "alguém acabou de entrar"
// ═══════════════════════════════════════════════════════════════════════
const SOCIAL_NAMES = [
  "Lucas", "Matheus", "Gabriel", "Pedro", "Rafael",
  "Bruno", "Diego", "Rodrigo", "Thiago", "Felipe",
  "Eduardo", "Anderson", "Marcelo", "Carlos", "Vinicius",
];

async function sendSocialProof(chatId) {
  const name = SOCIAL_NAMES[rand(0, SOCIAL_NAMES.length - 1)];
  const templates = [
    `🔥 _${name} acabou de entrar no privado agora_`,
    `👀 _${name} liberou o acesso há pouco_`,
    `💦 _${name} está no privado nesse momento_`,
    `🚨 _${name} entrou há menos de 1 minuto_`,
    `⚡ _+1 homem entrou enquanto você lê isso_`,
  ];
  await bot.sendMessage(chatId, templates[rand(0, templates.length - 1)], { parse_mode: "Markdown" });
}

// ═══════════════════════════════════════════════════════════════════════
// BARRA DE PROGRESSO — animação antes do checkout
// ═══════════════════════════════════════════════════════════════════════
async function sendProgressBar(chatId) {
  const frames = [
    "🔓 *Verificando seu acesso...*\n\n⬛⬛⬛⬛⬛  `0%`",
    "🔓 *Verificando seu acesso...*\n\n🟥⬛⬛⬛⬛  `20%`",
    "🔓 *Verificando seu acesso...*\n\n🟥🟥🟥⬛⬛  `60%`",
    "🔓 *Verificando seu acesso...*\n\n🟥🟥🟥🟥⬛  `80%`",
    "✅ *Acesso liberado!*\n\n🟥🟥🟥🟥🟥  `100%`",
  ];
  const msg = await bot.sendMessage(chatId, frames[0], { parse_mode: "Markdown" });
  const msgId = msg.message_id;
  const delays = [900, 700, 500, 800];
  for (let i = 1; i < frames.length; i++) {
    await sleep(delays[i - 1]);
    await bot.editMessageText(frames[i], {
      chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
    }).catch(() => {});
  }
  await sleep(700);
}

// ═══════════════════════════════════════════════════════════════════════
// REMARKETING — agenda 3 ondas (10m / 1h / 24h) por etapa
// ═══════════════════════════════════════════════════════════════════════
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

        await sendFunnelVideo(chatId, "checkout-video.mp4");
        await sleep(500);

        await bot.sendMessage(chatId, "tá… agora escolhe como você quer entrar.");
        await sleep(300);
        await bot.sendMessage(chatId, "3 opções. sem enrolar.");
        await sleep(300);

        await bot.sendMessage(chatId, "👇", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🚀 ACESSO AO VIVO — R$ 29,90",       callback_data: "plan:basic", style: "primary" }],
              [{ text: "💎 PREMIUM — R$ 49,90 🔥",            callback_data: "plan:plus"                   }],
              [{ text: "👑 VIP TOTAL — R$ 97,00",             callback_data: "plan:vip",   style: "success" }],
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

        await sendHuman(chatId, "Entra logo seu gostoso... 🥵🔥", {}, { autoSplit: true });
        await sendHuman(chatId, "eu não vou deixar isso aberto por muito tempo.", {}, { autoSplit: true });

        await logEventSafe(chatId, "PRE_NUDGE_SENT", {});
        return;
      }

      if (type === "REMARKETING") {
        const user = await prisma.user.findUnique({ where: { id: String(chatId) } });
        if (!user) return;
        if (user.pagou) return;

        const stage  = data?.stage;
        const etapa  = data?.etapa;

        // Só dispara se o lead ainda está na mesma etapa que gerou o agendamento
        if (user.etapa !== etapa) return;

        // ── webapp_pending: ganhou a roleta mas não entrou no mini app ──────
        if (etapa === "webapp_pending") {
          if (stage === "10m") {
            await sendSocialProof(chatId);
            await sleep(rand(800, 1200));
            await bot.sendMessage(chatId, "👇", {
              reply_markup: { inline_keyboard: [[{
                text: "🔒 ENTRAR NO PRIVADO AGORA",
                web_app: { url: process.env.WEBAPP_URL },
                style: "success",
              }]]},
            });
          } else if (stage === "1h") {
            await sendSocialProof(chatId);
            await sleep(rand(1000, 1800));
            await sendHuman(chatId, "faz uma hora que você me deixou esperando...", {}, { autoSplit: true });
            await sendHuman(chatId, "vou fechar o seu acesso daqui a pouco 🔒", {}, { autoSplit: true });
            await sleep(rand(800, 1200));
            await bot.sendMessage(chatId, "👇", {
              reply_markup: { inline_keyboard: [[{
                text: "🔒 GARANTIR MEU ACESSO AGORA",
                web_app: { url: process.env.WEBAPP_URL },
                style: "success",
              }]]},
            });
          } else if (stage === "24h") {
            await sendHuman(chatId, "última vez que te chamo aqui.", {}, { autoSplit: true });
            await sendHuman(chatId, "amanhã eu fecho esse acesso pra sempre 🔒", {}, { autoSplit: true });
            await sleep(rand(700, 1100));
            await bot.sendMessage(chatId, "👇", {
              reply_markup: { inline_keyboard: [[{
                text: "🔥 ÚLTIMA CHANCE — ENTRAR AGORA",
                web_app: { url: process.env.WEBAPP_URL },
                style: "danger",
              }]]},
            });
          }

        // ── checkout: viu os planos mas não escolheu ─────────────────────────
        } else if (etapa === "checkout") {
          if (stage === "10m") {
            await sendSocialProof(chatId);
            await sleep(rand(1200, 2000));
            await sendHuman(chatId, "você travou na hora de escolher?", {}, { autoSplit: true });
            await sendHuman(chatId, "enquanto você pensa, outros já estão dentro 👀", {}, { autoSplit: true });
          } else if (stage === "1h") {
            await sendHuman(chatId, "ainda tenho uma vaga separada no seu nome...", {}, { autoSplit: true });
            await sendHuman(chatId, "mas não fico esperando pra sempre 🔒", {}, { autoSplit: true });
          } else if (stage === "24h") {
            await sendHuman(chatId, "última chamada.", {}, { autoSplit: true });
            await sendHuman(chatId, "depois isso fecha e crio fila de espera.", {}, { autoSplit: true });
          }

        // ── pagamento: escolheu plano mas não pagou ──────────────────────────
        } else if (etapa === "pagamento") {
          if (stage === "10m") {
            await sendHuman(chatId, "você sumiu...", {}, { autoSplit: true });
            await sendHuman(chatId, "seu link ainda tá ativo, mas expira em breve ⏳", {}, { autoSplit: true });
          } else if (stage === "1h") {
            await sendHuman(chatId, "ficou com medo?", {}, { autoSplit: true });
            await sendHuman(chatId, "não tem motivo... entra e me descobre 😈", {}, { autoSplit: true });
          } else if (stage === "24h") {
            await sendHuman(chatId, "última chance real.", {}, { autoSplit: true });
            await sendHuman(chatId, "amanhã fecho e crio fila de espera 🔒", {}, { autoSplit: true });
          }
        }

        await logEventSafe(chatId, "REMARKETING_SENT", { stage, etapa });
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
        await sendFunnelVideo(chatId, "intro-video.mp4").catch(e => console.error("FUNNEL_START video:", e.message));
        await sleep(300);
        await bot.sendMessage(chatId, "Oi gato 😈");
        await sleep(300);
        await bot.sendMessage(chatId, "Acabei de acordar toda molhada pensando em um homem de verdade...");
        await sleep(300);
        await bot.sendMessage(chatId, "Tá tudo bem por aí?",
          { reply_markup: { inline_keyboard: [
            [{ text: "Tô bem 🔥",            callback_data: "start_sim",   style: "success" }],
            [{ text: "Tô ótimo, e você? 😏",  callback_data: "start_otimo"                   }],
            [{ text: "Tô afim de você 💦",    callback_data: "start_afim",  style: "primary" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_START", {});
        return;
      }

      if (type === "FUNNEL_STEP2") {
        await sendFunnelVideo(chatId, "step2-video.mp4").catch(e => console.error("FUNNEL_STEP2 video:", e.message));
        await sleep(rand(300, 500));
        await sendSocialProof(chatId);
        await sleep(rand(300, 500));
        await bot.sendMessage(chatId, "Que bom... Eu também tô bem, mas bem safadinha hoje 👀💦");
        await sleep(300);
        await bot.sendMessage(chatId, "Sabe, eu só faço chamada de vídeo peladinha pra quem realmente me excita de verdade...");
        await sleep(300);
        await bot.sendMessage(chatId, "Topa uma chamada bem gostosa e sem censura comigo agora?",
          { reply_markup: { inline_keyboard: [
            [{ text: "Quero sim 😈",           callback_data: "quero_video",     style: "success" }],
            [{ text: "Tô afim pra caralho 🔥", callback_data: "quero_video"                       }],
            [{ text: "Me mostra primeiro",      callback_data: "mostra_primeiro", style: "primary" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_STEP2", {});
        return;
      }

      if (type === "FUNNEL_ROLETA_INTRO") {
        await sendFunnelVideo(chatId, "step3-video.mp4").catch(e => console.error("FUNNEL_ROLETA_INTRO video:", e.message));
        await sleep(rand(300, 500));
        await sendSocialProof(chatId);
        await sleep(rand(300, 500));
        await bot.sendMessage(chatId, "Perfeito 😏");
        await sleep(300);
        await bot.sendMessage(chatId, "Mas pra me ver toda peladinha, e me ter bem putinha em um privado bem secreto, a gente vai ter que brincar de roleta da sorte 🎰");
        await sleep(300);
        await bot.sendMessage(chatId, "Você tem que acertar a sequencia de 3 numeros, se tiver essa sorte vai conseguir me ter bem putinha no meu privadinho safado 🥵");
        await sleep(300);
        await bot.sendMessage(chatId, "Quer tentar a sorte? 👀",
          { reply_markup: { inline_keyboard: [
            [{ text: "Quero tentar a sorte 🎰",   callback_data: "tentar_roleta_1", style: "success" }],
            [{ text: "Tô com muita sorte hoje 😈", callback_data: "tentar_roleta_1", style: "primary" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_ROLETA_INTRO", {});
        return;
      }

      if (type === "FUNNEL_NUM_GRID") {
        const round  = data?.round ?? 1;
        const label  = round === 2 ? "Última chance! Escolhe seu número de 1 a 10:" : "Escolhe um número de 1 a 10:";
        const numRow = (nums) => nums.map(n => ({ text: String(n), callback_data: `num${round}_${n}`, style: "primary" }));
        await bot.sendMessage(chatId, label, {
          reply_markup: { inline_keyboard: [ numRow([1,2,3,4,5]), numRow([6,7,8,9,10]) ] },
        });
        await logEventSafe(chatId, "FUNNEL_NUM_GRID", { round });
        return;
      }

      if (type === "FUNNEL_NUM_CHOSEN") {
        const round  = data?.round  ?? 1;
        const chosen = data?.chosen ?? 1;
        await bot.sendMessage(chatId, `Beleza! Escolheu o ${chosen} 😏`);
        await sleep(300);
        await bot.sendMessage(chatId, "CLIQUE ABAIXO PRA GIRAR A ROLETA... 👀🔥",
          { reply_markup: { inline_keyboard: [
            [{ text: "🎰 Girar Roleta", callback_data: `spin${round}_${chosen}`, style: "success" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_NUM_CHOSEN", { round, chosen });
        return;
      }

      if (type === "FUNNEL_SPIN") {
        const round  = data?.round  ?? 1;
        const chosen = data?.chosen ?? 1;
        const rn     = () => rand(1, 10);

        // Resultado final controlado
        // Round 1: perde — 3 colunas diferentes, nenhuma igual ao escolhido
        // Round 2: ganha — jackpot, todas as 3 colunas = número escolhido
        let c1, c2, c3;
        if (round === 2) {
          c1 = c2 = c3 = chosen;
        } else {
          do { c1 = rn(); } while (c1 === chosen);
          do { c2 = rn(); } while (c2 === chosen || c2 === c1);
          do { c3 = rn(); } while (c3 === chosen || c3 === c1 || c3 === c2);
        }

        // Monta o frame do slot machine
        // locked[i] = true → coluna travada (bold)
        const slotFrame = (status, a, b, c, locked = [false, false, false]) => {
          const col = (n, l) => l ? `<b>[${n}]</b>` : `[${n}]`;
          return `${status}\n\n🎰  ${col(a, locked[0])}  ${col(b, locked[1])}  ${col(c, locked[2])}  🎰`;
        };

        const initMsg = await bot.sendMessage(
          chatId,
          slotFrame("⚡ <i>girando...</i>", rn(), rn(), rn()),
          { parse_mode: "HTML" }
        );
        const msgId = initMsg.message_id;

        const edit = (text) => bot.editMessageText(text, {
          chat_id: chatId, message_id: msgId, parse_mode: "HTML",
        }).catch(() => {});

        // Fase 1: giro rápido (todas colunas aleatórias)
        for (const d of [110, 120, 130, 140]) {
          await sleep(d);
          await edit(slotFrame("⚡ <i>girando...</i>", rn(), rn(), rn()));
        }

        // Fase 2: desacelera (todas ainda aleatórias)
        for (const d of [180, 230, 290]) {
          await sleep(d);
          await edit(slotFrame("🔄 <i>desacelerando...</i>", rn(), rn(), rn()));
        }

        // Fase 3: coluna esquerda trava
        await sleep(370);
        await edit(slotFrame("🔥 <i>parando...</i>", c1, rn(), rn(), [true, false, false]));

        // Fase 4: coluna do meio trava
        await sleep(520);
        await edit(slotFrame("💥 <i>vai...</i>", c1, c2, rn(), [true, true, false]));

        // Fase 5: resultado final — coluna direita trava
        await sleep(700);

        if (round === 1) {
          await edit(`😔 <b>Quase jackpot!</b>\n\n🎰  [${c1}]  [${c2}]  [${c3}]  🎰`);
          await sleep(900);

          await sendFunnelVideo(chatId, "lose-video.mp4").catch(e => console.error("lose video:", e.message));
          await sleep(300);
          await bot.sendMessage(chatId, `Quase... caiu ${c1} — ${c2} — ${c3} 😔`);
          await sleep(300);
          await bot.sendMessage(chatId, "Não foi dessa vez...");
          await sleep(300);
          await bot.sendMessage(chatId, "Mas você ainda tem uma última chance. Quer tentar de novo?",
            { reply_markup: { inline_keyboard: [
              [{ text: "🔥 Quero tentar novamente", callback_data: "tentar_roleta_2", style: "success" }],
              [{ text: "Desistir",                   callback_data: "desistir",         style: "danger"  }],
            ]}}
          );
        } else {
          await edit(`💥 <b>J A C K P O T ! !</b> 💥\n\n🎰  <b>[${c1}]</b>  <b>[${c2}]</b>  <b>[${c3}]</b>  🎰`);
          await sleep(800);

          await sendProgressBar(chatId);
          await sleep(300);
          await sendSocialProof(chatId);
          await sleep(300);
          await sendFunnelPhoto(chatId, "win-photo.jpg").catch(e => console.error("win photo:", e.message));
          await sleep(300);
          await bot.sendMessage(chatId, "🔥🔥 PORRA KKKKKK VC É MUITO SORTUDO CARALHO!! 🔥🔥");
          await sleep(300);
          await bot.sendMessage(chatId, "Dessa vez caiu o seu número!!");
          await sleep(300);
          await bot.sendMessage(chatId, "Acabei de liberar o acesso pro meu privado 😈");
          await sleep(300);
          await bot.sendMessage(chatId, "Entra agora pra me ver peladinha na chamada de vídeo 💦",
            { reply_markup: { inline_keyboard: [[{
              text: "🚀 ENTRAR NO MINI APP AGORA",
              web_app: { url: process.env.WEBAPP_URL },
              style: "success",
            }]]}}
          );
          await sleep(500);
          await bot.sendMessage(chatId, "Entra logo seu gostoso... 🥵🔥");
          await sleep(300);
          await bot.sendMessage(chatId, "eu não vou deixar isso aberto por muito tempo.");
          await prisma.user.update({
            where: { id: String(chatId) },
            data:  { etapa: "webapp_pending" },
          }).catch(() => {});
          await scheduleRemarketingJobs(chatId, "webapp_pending");
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