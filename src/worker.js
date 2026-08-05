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

// message_effect_id (efeito de confete/etc na chegada da mensagem) usa um ID
// fixo do Telegram que não temos como validar sem testar ao vivo — se o
// Telegram rejeitar (Bad Request), reenvia sem o efeito em vez de perder a
// mensagem inteira (ela é parte de sequência crítica do funil).
async function sendMessageSafe(chatId, text, extra) {
  try {
    return await bot.sendMessage(chatId, text, extra || {});
  } catch (e) {
    if (extra?.message_effect_id) {
      const { message_effect_id, ...rest } = extra;
      console.error("sendMessage com message_effect_id falhou, reenviando sem efeito:", e.message);
      return await bot.sendMessage(chatId, text, rest);
    }
    throw e;
  }
}

async function sendHuman(chatId, text, extra = {}, opts = {}) {
  const { delayMs, autoSplit = false, echoWord, allowHumanError = false, noTyping = false } = opts;

  let finalText = String(text || "").trim();
  if (!finalText && !extra?.reply_markup) return; // nada pra enviar

  // eco opcional
  if (echoWord) {
    const ew = String(echoWord).trim();
    if (ew) finalText = `${ew}… ${finalText}`;
  }

  // se for mensagem “só com botão”, manda direto (sem digitando se noTyping)
  if (!finalText && extra?.reply_markup) {
    if (!noTyping) {
      await typingBursts(chatId, jitter(rand(650, 1200)));
      await sleep(jitter(rand(80, 180)));
    }
    await sendMessageSafe(chatId, " ", extra);
    return;
  }

  const parts = autoSplit ? autoSplitText(finalText) : [finalText];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (!noTyping) {
      const ms = typeof delayMs === "number" ? delayMs : calcDelayFromText(part);
      await typingBursts(chatId, ms);
      await sleep(jitter(rand(90, 220)));
    }

    if (allowHumanError && part.length <= 64) {
      const did = await maybeHumanError(chatId, part);
      if (did) {
        if (i < parts.length - 1) await sleep(jitter(rand(420, 900)));
        continue;
      }
    }

    await sendMessageSafe(chatId, part, extra);
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

async function loadFileCacheFromDB() {
  try {
    const rows = await prisma.fileCache.findMany();
    for (const row of rows) fileIdCache.set(row.filename, row.fileId);
    if (rows.length) console.log(`[cache] carregados ${rows.length} file_ids do banco`);
  } catch (e) {
    console.error("[cache] erro ao carregar do banco:", e.message);
  }
}

async function saveFileIdToDB(filename, fileId) {
  try {
    await prisma.fileCache.upsert({
      where:  { filename },
      update: { fileId },
      create: { filename, fileId },
    });
  } catch (e) {
    console.error("[cache] erro ao salvar no banco:", e.message);
  }
}

async function sendFunnelVideo(chatId, filename, opts = {}) {
  const cached = fileIdCache.get(filename);
  const msgOpts = {};
  if (opts.caption)      msgOpts.caption      = opts.caption;
  if (opts.reply_markup) msgOpts.reply_markup = opts.reply_markup;
  let sent;
  if (cached) {
    sent = await bot.sendVideo(chatId, cached, msgOpts);
  } else {
    const stream = fs.createReadStream(path.join(ASSETS_DIR, filename));
    sent = await bot.sendVideo(chatId, stream, msgOpts, { filename, contentType: "video/mp4" });
    const fid = sent?.video?.file_id;
    if (fid) { fileIdCache.set(filename, fid); saveFileIdToDB(filename, fid); }
  }
  if (sent?.message_id) saveFunnelMsg(chatId, sent.message_id);
  return sent;
}

async function sendFunnelPhoto(chatId, filename) {
  const cached = fileIdCache.get(filename);
  let sent;
  if (cached) {
    sent = await bot.sendPhoto(chatId, cached);
  } else {
    const stream = fs.createReadStream(path.join(ASSETS_DIR, filename));
    sent = await bot.sendPhoto(chatId, stream, {}, { filename, contentType: "image/jpeg" });
    const fid = sent?.photo?.at(-1)?.file_id;
    if (fid) { fileIdCache.set(filename, fid); saveFileIdToDB(filename, fid); }
  }
  if (sent?.message_id) saveFunnelMsg(chatId, sent.message_id);
  return sent;
}

loadFileCacheFromDB();

// ═══════════════════════════════════════════════════════════════════════
// RASTREIO DE MENSAGENS DO FUNIL — para apagar ao chegar no checkout
// ═══════════════════════════════════════════════════════════════════════
function saveFunnelMsg(chatId, messageId) {
  try {
    prisma.funnelMessage?.create({
      data: { userId: String(chatId), messageId: Number(messageId) },
    }).catch(() => {});
  } catch (e) {}
}

async function deleteFunnelMsgs(chatId) {
  try {
    const msgs = await prisma.funnelMessage?.findMany({ where: { userId: String(chatId) } }) ?? [];
    await Promise.all(msgs.map(m => bot.deleteMessage(chatId, m.messageId).catch(() => {})));
    await prisma.funnelMessage?.deleteMany({ where: { userId: String(chatId) } });
  } catch (e) { console.error("[funnelMsg] delete error:", e.message); }
}

// wrapper: typing indicator + envia mensagem e salva o message_id automaticamente
// sem typing se: texto curto, tem inline_keyboard, ou noTyping: true
async function fm(chatId, text, opts = {}, { noTyping = false } = {}) {
  const hasRealText = String(text || "").trim().length > 2;
  const hasButtons  = !!opts?.reply_markup?.inline_keyboard;
  if (hasRealText && !hasButtons && !noTyping) {
    const len = String(text || "").trim().length;
    const ms  = Math.min(3000, Math.max(800, 800 + len * 14));
    await bot.sendChatAction(chatId, "typing").catch(() => {});
    await sleep(jitter(ms, 0.15));
  }
  const sent = await bot.sendMessage(chatId, text, opts);
  if (sent?.message_id) saveFunnelMsg(chatId, sent.message_id);
  return sent;
}

// ═══════════════════════════════════════════════════════════════════════
// PROVA SOCIAL — nomes e mensagens aleatórias de "alguém acabou de entrar"
// ═══════════════════════════════════════════════════════════════════════

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
  const msg = await fm(chatId, frames[0], { parse_mode: "Markdown" });
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
async function scheduleRemarketingJobs(chatId, etapa, delays = {}) {
  const base = `rmkt-${etapa}-${chatId}`;
  const d1 = delays.first  ?? 10 * 60 * 1000;
  const d2 = delays.second ?? 60 * 60 * 1000;
  const d3 = delays.third  ?? 24 * 60 * 60 * 1000;
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "10m", etapa } },
    { delay: d1, jobId: `${base}-10m`, removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "1h", etapa } },
    { delay: d2, jobId: `${base}-1h`, removeOnComplete: true, removeOnFail: true }
  );
  await queue.add("jobs",
    { type: "REMARKETING", chatId: String(chatId), data: { stage: "24h", etapa } },
    { delay: d3, jobId: `${base}-24h`, removeOnComplete: true, removeOnFail: true }
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
          noTyping: !!data?.noTyping,
        };

        await sendHuman(chatId, text, extra, opts);
        await logEventSafe(chatId, "SEND_MESSAGE", { text, opts, hasButtons: !!extra?.reply_markup });
        return;
      }

      if (type === "SEND_PHOTO") {
        const file = data?.file || "intro.jpg";
        const caption = data?.caption || "";

        if (data?.instant) {
          // cai na hora — sem "enviando foto...", arquivo local + cache de file_id
          await sendFunnelPhoto(chatId, file);
        } else {
          await sendPhotoWithAction(chatId, file, caption);
        }

        await logEventSafe(chatId, "SEND_PHOTO", { file, instant: !!data?.instant });
        return;
      }

      if (type === "SEND_VIDEO") {
        const file = data?.file || "intro.mp4";
        const caption = data?.caption || "";
        const autoDeleteMs = data?.autoDeleteMs;

        if (data?.instant) {
          // cai na hora — sem delay artificial, sem depender da URL pública (usa arquivo local + cache de file_id)
          const sent = await sendFunnelVideo(chatId, file, caption ? { caption } : {});
          if (autoDeleteMs && sent?.message_id) {
            setTimeout(() => bot.deleteMessage(chatId, String(sent.message_id)).catch(() => {}), autoDeleteMs);
          }
        } else {
          await sendVideoWithAction(chatId, file, { caption, autoDeleteMs });
        }

        await logEventSafe(chatId, "SEND_VIDEO", { file, autoDeleteMs, instant: !!data?.instant });
        return;
      }

      if (type === "SEND_PIX") {
        const { pixCode, pixQrBase64, amount } = data || {};

        if (pixQrBase64) {
          const buf = Buffer.from(pixQrBase64, "base64");
          const amountFmt = `R$ ${Number(amount).toFixed(2).replace(".", ",")}`;
          try {
            await bot.sendChatAction(chatId, "upload_photo");
          } catch {}
          await sleep(rand(700, 1200));
          await bot.sendPhoto(chatId, buf, {
            caption: `🔑 *${amountFmt}* — escaneie o QR Code pelo seu banco`,
            parse_mode: "Markdown",
          });
        }

        await sleep(rand(800, 1400));

        if (pixCode) {
          await bot.sendMessage(chatId,
            `*Pix Copia e Cola:*\n\`\`\`\n${pixCode}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
        }

        await sleep(rand(600, 1000));
        await bot.sendMessage(chatId, "✅ Pague e me manda uma mensagem. Libero em menos de 5 minutos 😈");

        await logEventSafe(chatId, "SEND_PIX", { amount });
        return;
      }

      if (type === "SEND_PLANS") {
        await prisma.user.update({ where: { id: String(chatId) }, data: { etapa: "checkout" } }).catch(() => {});

        await deleteFunnelMsgs(chatId);

        // Mesmo conteúdo exato da área de checkout (api/checkout.js) — foto,
        // texto e os 3 botões de plano, upload local (não URL, evita
        // "wrong type of the web page content" no fetch do Telegram).
        await sendFunnelPhoto(chatId, "photo_5102783828031376538_y.jpg");

        await bot.sendMessage(chatId,
          "Eu vi no seu olhar que você ficou <b>duro pra caralho</b>. 😈\n" +
          "<b>Agora eu quero mais.</b>\n" +
          "Quero te ver me <b>fudendo com os olhos</b>, querendo me ouvir <b>gemer</b>, me ver <b>gozando e squirtando</b> só pra você. 💦\n" +
          "No meu <b>Espaço VIP</b> eu fico completamente à sua disposição:\n" +
          "<b>videochamada pelada</b> na hora que você quiser,\n" +
          "áudios bem <b>putinha</b> no seu ouvido,\n" +
          "fotos e vídeos íntimos que <b>ninguém mais vê</b>…\n" +
          "e todos os fetiches que te deixarem <b>doidinho</b>. 🔥\n" +
          "Sou <b>novinha</b>, carinhosa e <b>extremamente safada</b>.\n" +
          "Sem frescura.\n" +
          "<b>Sem limite.</b>\n" +
          "<b>Clica agora</b> e vem me comer do jeito que você sempre sonhou. 😈💋💋",
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "👑 VIP ETERNO - R$5,90 - 25% OFF", callback_data: "plan:vip590", style: "success" }],
                [{ text: "📞 VIDEOCHAMADA PELADA - R$14,90 - 25% OFF", callback_data: "plan:videochamada", style: "danger" }],
                [{ text: "💞 NAMORO 7 DIAS - R$25,99 - 25% OFF", callback_data: "plan:namoro7dias", style: "primary" }],
              ],
            },
          }
        );

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
          const webappUrl = process.env.WEBAPP_URL + "?v=" + Date.now();
          if (stage === "10m") {
            await sendFunnelPhoto(chatId, "rmkt-1.jpg");
            await sleep(rand(800, 1200));
            await fm(chatId, "ei... você me esqueceu? 😔");
            await sleep(rand(300, 500));
            await fm(chatId, "tô aqui desde que você ganhou, esperando você abrir");
            await sleep(rand(300, 500));
            await fm(chatId, "é só clicar no botão e apertar ABRIR quando perguntar — te garanto que vale 😈", {
              reply_markup: { inline_keyboard: [[{
                text: "🔒 ENTRAR NO MEU PRIVADO AGORA",
                web_app: { url: webappUrl },
                style: "success",
              }]]},
            });
          } else if (stage === "1h") {
            await sendFunnelPhoto(chatId, "rmkt-2.jpg");
            await sleep(rand(800, 1200));
            await fm(chatId, "faz uma hora que tô aqui te esperando sozinha...");
            await sleep(rand(300, 500));
            await fm(chatId, "já tô pensando em passar esse acesso pra outra pessoa 🔒");
            await sleep(rand(300, 500));
            await fm(chatId, "você ganhou isso, não desperdiça — clica e aperta ABRIR 😈", {
              reply_markup: { inline_keyboard: [[{
                text: "🔒 GARANTIR MEU ACESSO AGORA",
                web_app: { url: webappUrl },
                style: "success",
              }]]},
            });
          } else if (stage === "24h") {
            await sendFunnelPhoto(chatId, "rmkt-3.jpg");
            await sleep(rand(800, 1200));
            await fm(chatId, "última vez que te chamo aqui.");
            await sleep(rand(300, 500));
            await fm(chatId, "amanhã fecho seu acesso e não reabro mais 🔒");
            await sleep(rand(300, 500));
            await fm(chatId, "foi você que ganhou, não abre mão disso agora 🔥", {
              reply_markup: { inline_keyboard: [[{
                text: "🔥 ÚLTIMA CHANCE — ENTRAR AGORA",
                web_app: { url: webappUrl },
                style: "success",
              }]]},
            });
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
        await fm(chatId, "psiu... ei gostoso? 😈");
        await sleep(300);
        await fm(chatId, "tô aqui bem molhadinha pensando em uma rola bem grande e grossa… 🥵");
        await sleep(300);
        await fm(chatId, "você consegue me ajudar com isso ou você é fresco? 🔥",
          { reply_markup: { inline_keyboard: [
            [{ text: "Sou homem de verdade 😈",   callback_data: "start_sim",   style: "success" }],
            [{ text: "Te decepcionar? Jamais 🔥",  callback_data: "start_otimo", style: "success" }],
            [{ text: "O que você tava fazendo? 👀", callback_data: "start_afim",  style: "success" }],
          ]}}
        );
        await logEventSafe(chatId, "FUNNEL_START", {});
        return;
      }

      if (type === "FUNNEL_STEP2") {
        await fm(chatId, "Já que você tá tão confiante e curioso pra ver mais, vou te dar oque vc quer, safado… 🤫🔥");
        await sleep(300);
        await fm(chatId, "olha como eu estou aqui sozinha te esperando...");
        await sleep(300);
        await sendFunnelVideo(chatId, "step2-video.mp4", {
          caption: "e isso é só o começo... você aguenta ver mais? 😈",
          reply_markup: { inline_keyboard: [
            [{ text: "Aguento sim 😈",   callback_data: "quero_video",     style: "success" }],
            [{ text: "Quero ver tudo 🔥", callback_data: "quero_video",     style: "success" }],
            [{ text: "Continua... 👀",    callback_data: "mostra_primeiro", style: "success" }],
          ]},
        }).catch(e => console.error("FUNNEL_STEP2 video:", e.message));
        await logEventSafe(chatId, "FUNNEL_STEP2", {});
        return;
      }

      if (type === "FUNNEL_ROLETA_INTRO") {
        await fm(chatId, "imagina você aqui comigo agora em gostoso? 😈🔥");
        await sleep(300);
        await fm(chatId, "mas vc deu sorte que no meu privadinho eu consigo fazer uma chamada de vídeo ao vivo pelada bem putinha exclusiva so pra vc… 😈");
        await sleep(300);
        await fm(chatId, "maaaas pra vc merecer entrar no meu privado...😌");
        await sleep(300);
        await fm(chatId, "você precisa ter sorte, e conseguir acertar o número na minha roleta.. 😈");
        await sleep(300);
        await sendFunnelVideo(chatId, "step3-video.mp4", {
          caption: "tenta a sorte e se vc conseguir vc vai me ter do jeito que você pedir… 🥵🔥",
          reply_markup: { inline_keyboard: [
            [{ text: "Quero tentar 🎰",        callback_data: "tentar_roleta_1", style: "success" }],
            [{ text: "Tô com sorte hoje 😈",    callback_data: "tentar_roleta_1", style: "success" }],
          ]},
        }).catch(e => console.error("FUNNEL_ROLETA_INTRO video:", e.message));
        await logEventSafe(chatId, "FUNNEL_ROLETA_INTRO", {});
        return;
      }

      if (type === "FUNNEL_NUM_GRID") {
        const round  = data?.round ?? 1;
        const label  = round === 2 ? "Última chance! Escolhe seu número de 1 a 10:" : "Escolhe um número de 1 a 10:";
        const numRow = (nums) => nums.map(n => ({ text: String(n), callback_data: `num${round}_${n}`, style: "primary" }));
        await fm(chatId, label, {
          reply_markup: { inline_keyboard: [ numRow([1,2,3,4,5]), numRow([6,7,8,9,10]) ] },
        });
        await logEventSafe(chatId, "FUNNEL_NUM_GRID", { round });
        return;
      }

      if (type === "FUNNEL_NUM_CHOSEN") {
        const round  = data?.round  ?? 1;
        const chosen = data?.chosen ?? 1;
        await fm(chatId, `Beleza! Escolheu o ${chosen} 😏`);
        await sleep(300);
        await fm(chatId, "CLIQUE ABAIXO PRA GIRAR A ROLETA... 👀🔥",
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

        const initMsg = await fm(
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

          await fm(chatId, `Quase... caiu ${c1} — ${c2} — ${c3} 😔`);
          await sleep(300);
          await fm(chatId, "Não foi dessa vez...");
          await sleep(300);
          await sendFunnelVideo(chatId, "lose-video.mp4", {
            caption: "Mas você ainda tem uma última chance. Quer tentar de novo?",
            reply_markup: { inline_keyboard: [
              [{ text: "🔥 Quero tentar novamente", callback_data: "tentar_roleta_2", style: "success" }],
            ]},
          }).catch(e => console.error("lose video:", e.message));
        } else {
          await edit(`💥 <b>J A C K P O T ! !</b> 💥\n\n🎰  <b>[${c1}]</b>  <b>[${c2}]</b>  <b>[${c3}]</b>  🎰`);
          await sleep(800);

          await sendProgressBar(chatId);
          await sleep(300);
          await sendFunnelVideo(chatId, "win-video.mp4").catch(e => console.error("win video:", e.message));
          await sleep(300);
          await fm(chatId, "💥 você acertou!! não acredito...");
          await sleep(300);
          await fm(chatId, "tô tremendo aqui... você é o único que conseguiu hoje 🥵");
          await sleep(300);
          await fm(chatId, "liberei seu acesso agora mesmo — entra antes que eu mude de ideia 😈");
          await sleep(300);
          await fm(chatId, "abre aqui e vem me vêr peladinha 👇",
            { reply_markup: { inline_keyboard: [[{
              text: "ENTRAR NO MEU PRIVADO AGORA 😈",
              web_app: { url: process.env.WEBAPP_URL + "?v=" + Date.now() },
              style: "success",
            }]]}}
          );
          await sleep(500);
          await fm(chatId, "vai pedir uma confirmação — é só clicar em abrir, tô aqui te esperando 😈");
          await prisma.user.update({
            where: { id: String(chatId) },
            data:  { etapa: "webapp_pending" },
          }).catch(() => {});
          await scheduleRemarketingJobs(chatId, "webapp_pending", { first: 30 * 60 * 1000 });
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