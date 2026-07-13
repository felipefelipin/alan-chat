// src/bot.js
require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { mpCreatePix } = require("../payments/mp");

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// helper: BullMQ nessa versão não aceita ":" em jobId
const jid = (...parts) => parts.join("-");

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

  // save to DB without blocking the flow
  prisma.payment.create({
    data: { userId: String(chatId), plano, status: "pending", preferenceId: paymentId, initPoint: pixCode },
  }).catch(e => console.error("payment save error:", e));

  await setEtapa(chatId, "pagamento");

  // send inline — no worker dependency
  await sleep(rand(1200, 2000));
  await bot.sendMessage(chatId, "Perfeito! Seu pedido foi gerado com sucesso 🔥");

  await sleep(rand(1800, 2600));
  await bot.sendMessage(chatId, "Aqui está seu Pix para pagamento:");

  await sleep(rand(1000, 1600));

  if (pixQrBase64) {
    const buf = Buffer.from(pixQrBase64, "base64");
    await bot.sendChatAction(chatId, "upload_photo").catch(() => {});
    await sleep(rand(700, 1200));
    const amountFmt = `R$ ${Number(amount).toFixed(2).replace(".", ",")}`;
    await bot.sendPhoto(chatId, buf, {
      caption: `💸 *${amountFmt}* — Escaneie o QR Code pelo app do seu banco`,
      parse_mode: "Markdown",
    });
  }

  await sleep(rand(800, 1400));

  if (pixCode) {
    await bot.sendMessage(chatId, "Ou copie o código Pix abaixo:");
    await sleep(rand(400, 700));
    await bot.sendMessage(chatId,
      `\`\`\`\n${pixCode}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  await sleep(rand(600, 1000));
  const planNames = { mensal: "Acesso Mensal", vitalicio: "Acesso Vitalício" };
  const planTitle = planNames[plano] ?? plano;
  await bot.sendMessage(chatId, `Assim que o pagamento for confirmado, o link do *${planTitle}* cai aqui automaticamente 🔒✅`, { parse_mode: "Markdown" });

  await scheduleRemarketingJobs(chatId, "pagamento");
}

// =============================================================================
// Funil direto — Tela 1 (vídeo + mensagem + botão) → Tela 2 (vídeo + menu)
// =============================================================================
const START_MESSAGE = `Oi gostoso 😈
<b>Bem-vindo ao meu cantinho mais safado no Telegram...</b>
Aqui dentro eu solto tudo que no Instagram não deixam 🔥💦

👇 <i>Clique abaixo e acessa todos meus conteúdinhos</i>`;

async function runDirectFunnel(chatId) {
  await queue.add("jobs",
    { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "0708.mp4", caption: "", instant: true } },
    { delay: 0, jobId: jid("start", chatId, 1), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: {
      text: START_MESSAGE,
      autoSplit: false,
      delayMs: 1500,
      extra: { parse_mode: "HTML", reply_markup: { inline_keyboard: [
        [{ text: "ACESSAR MEUS CONTEÚDINHOS! 🔓", callback_data: "ver_conteudinhos", style: "success" }],
      ]}},
    }},
    { delay: rand(300, 600), jobId: jid("start", chatId, 2), removeOnComplete: true, removeOnFail: true }
  );
}

// =============================================================================
// /start — dispara o funil direto
// =============================================================================
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await upsertUser(chatId);
  await cancelPreNudge(chatId);
  await runDirectFunnel(chatId);
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
    // ── Tela 2 — menu principal (Instagram / Chat + Ao Vivo / Ver Planos) ────
    if (data === "ver_conteudinhos") {
      await bot.answerCallbackQuery(q.id, { text: "😈" }).catch(() => {});
      await queue.add("jobs",
        { type: "SEND_PHOTO", chatId: String(chatId), data: { file: "photo_5071206571341188083_w.jpg", caption: "" } },
        { delay: rand(300, 700), jobId: jid("conteudinhos", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "Tudo isso é seu, é só escolher por onde quer começar 🔥👇",
          extra: { reply_markup: { inline_keyboard: [
            [{ text: "📸 Vem me ver no Insta 👀",         callback_data: "abrir_instagram", style: "primary" }],
            [{ text: "😈 Chamada de vídeo AO VIVO 💦",    callback_data: "chamada_video",   style: "danger"  }],
            [{ text: "💰 Quero ver os PLANOS 🔥",          callback_data: "ver_planos",      style: "success" }],
          ]}},
        }},
        { delay: rand(1800, 2600), jobId: jid("conteudinhos", chatId, 2), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Instagram (mini app dedicado) ────────────────────────────────────────
    if (data === "abrir_instagram") {
      await bot.answerCallbackQuery(q.id, { text: "😈" }).catch(() => {});
      await queue.add("jobs",
        { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "IMG_7068.MP4", caption: "" } },
        { delay: rand(300, 700), jobId: jid("instagram", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "vem ver meu perfil 👇",
          extra: { reply_markup: { inline_keyboard: [
            [{ text: "📸 Abrir Instagram", web_app: { url: process.env.WEBAPP_URL + "/instagram/?v=" + Date.now() } }],
          ]}},
        }},
        { delay: rand(1800, 2600), jobId: jid("instagram", chatId, 2), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Ver planos ────────────────────────────────────────────────────────────
    if (data === "ver_planos") {
      await bot.answerCallbackQuery(q.id, { text: "👀" }).catch(() => {});
      await cancelPreNudge(chatId);
      await sendPlans(chatId);
      return;
    }

    // ── Chamada de vídeo → libera botão do mini app ─────────────────────────
    if (data === "chamada_video") {
      await bot.answerCallbackQuery(q.id, { text: "😈" }).catch(() => {});
      await queue.add("jobs",
        { type: "SEND_PHOTO", chatId: String(chatId), data: { file: "photo_5067007776952880376_w.jpg", caption: "" } },
        { delay: rand(300, 700), jobId: jid("chamada_video", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "entra aqui que eu já vou te chamar 👇",
          extra: { reply_markup: { inline_keyboard: [
            [{ text: "ENTRAR NO PRIVADO 🔒", web_app: { url: process.env.WEBAPP_URL + "?v=" + Date.now() } }],
          ]}},
        }},
        { delay: rand(1800, 2600), jobId: jid("chamada_video", chatId, 2), removeOnComplete: true, removeOnFail: true }
      );
      await setEtapa(chatId, "webapp_pending");
      await schedulePreNudge(chatId);
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
