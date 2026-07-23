// src/bot.js
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { mpCreatePix } = require("../payments/mp");

const prisma = new PrismaClient();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ASSETS_DIR = path.join(__dirname, "..", "public", "assets");

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

// Texto explicando e "vendendo" cada plano, mandado logo antes do Pix —
// reforça o valor bem na hora que a pessoa está prestes a pagar (reduz
// desistência/arrependimento no último passo).
const PLAN_PITCH = {
  vip590:
    "🔥 <b>VIP ETERNO — pra sempre, sem mensalidade</b>\n\n" +
    "Você paga uma vez só e o acesso é seu pro resto da vida: videochamada pelada comigo sempre que quiser, áudios gemendo bem baixinho no seu ouvido, fotos e vídeos bem íntimos, squirt ao vivo e todos os fetiches que te deixarem louco.\n\n" +
    "Sem clube de assinatura, sem cobrança todo mês — R$ 5,90 uma única vez e você tem acesso vitalício a mim. Não existe forma mais barata de ter isso.",
  videochamada:
    "📞 <b>VIDEOCHAMADA PELADA — eu, ao vivo, só pra você</b>\n\n" +
    "Nada de foto ou vídeo gravado: é uma chamada de vídeo comigo, na hora, pelada, gemendo do jeito que você pedir. Você manda, eu obedeço — na câmera, ao vivo, sem cortes e sem vergonha nenhuma.\n\n" +
    "É a experiência mais real que existe: a sensação de eu estar ali, bem na sua frente, só respondendo a você.",
  namoro7dias:
    "💞 <b>NAMORO 7 DIAS — sete dias sendo sua namorada de verdade</b>\n\n" +
    "Durante uma semana inteira eu sou só sua: bom dia todo dia, atenção o dia inteiro, conversa de namorados, carinho e a sensação de ter uma namorada gostosa e sempre disponível pra você — sem regras, só o gostoso de ter alguém sua.\n\n" +
    "Não é só sexo, é ter uma namorada particular por 7 dias — a experiência mais completa que eu ofereço.",
};

async function createCheckoutAndSend(chatId, plano) {
  // Foto + pitch caem IMEDIATAMENTE, antes de qualquer chamada de rede —
  // gerar o Pix é uma chamada externa (Mercado Pago) que pode demorar
  // alguns segundos, e isso não pode segurar a reação instantânea ao clique.
  const pitch = PLAN_PITCH[plano];
  if (pitch) {
    // Upload direto do arquivo local (multipart), não a URL — pedir pro
    // Telegram buscar a URL pública dava "wrong type of the web page
    // content" (o fetch dele não reconhecia o conteúdo como foto válida).
    try {
      await bot.sendPhoto(chatId, fs.createReadStream(path.join(ASSETS_DIR, "photo_5114032093976530239_w.jpg")));
    } catch (e) { console.error("pitch photo send error:", e.message); }
    await sleep(1000);
    await bot.sendMessage(chatId, pitch, { parse_mode: "HTML" });
  }

  const { paymentId, pixCode, pixQrBase64, amount } = await mpCreatePix({ chatId, plano });

  // save to DB without blocking the flow
  prisma.payment.create({
    data: { userId: String(chatId), plano, status: "pending", preferenceId: paymentId, initPoint: pixCode },
  }).catch(e => console.error("payment save error:", e));

  await setEtapa(chatId, "pagamento");

  // resto cai tudo junto, sem demora — só o pitch acima tem timing próprio
  await bot.sendMessage(chatId, "Perfeito! Seu pedido foi gerado com sucesso 🔥");
  await bot.sendMessage(chatId, "Aqui está seu Pix para pagamento:");

  if (pixQrBase64) {
    const buf = Buffer.from(pixQrBase64, "base64");
    const amountFmt = `R$ ${Number(amount).toFixed(2).replace(".", ",")}`;
    await bot.sendPhoto(chatId, buf, {
      caption: `💸 *${amountFmt}* — Escaneie o QR Code pelo app do seu banco`,
      parse_mode: "Markdown",
    });
  }

  if (pixCode) {
    await bot.sendMessage(chatId, "Ou copie o código Pix abaixo:");
    await bot.sendMessage(chatId,
      `\`\`\`\n${pixCode}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  const planNames = { mensal: "Acesso Mensal", vitalicio: "Acesso Vitalício", vip590: "VIP Eterno", videochamada: "Videochamada Pelada", namoro7dias: "Namoro 7 Dias" };
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
    { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "IMG_4755.MP4", caption: "", instant: true } },
    { delay: 0, jobId: jid("start", chatId, 1), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add("jobs",
    { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "0708.mp4", caption: "", instant: true } },
    { delay: 1000, jobId: jid("start", chatId, 2), removeOnComplete: true, removeOnFail: true }
  );

  await queue.add("jobs",
    { type: "SEND_MESSAGE", chatId: String(chatId), data: {
      text: START_MESSAGE,
      autoSplit: false,
      noTyping: true,
      extra: { parse_mode: "HTML", reply_markup: { inline_keyboard: [
        [{ text: "ACESSAR MEUS CONTEÚDINHOS! 🔓", callback_data: "ver_conteudinhos", style: "success" }],
      ]}},
    }},
    { delay: 2000, jobId: jid("start", chatId, 3), removeOnComplete: true, removeOnFail: true }
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
// /kbtest — TEMPORÁRIO: abre a página isolada de teste do bug de teclado
// como Mini App de verdade (Experimento 3 da investigação). Remover depois.
// =============================================================================
bot.onText(/^\/kbtest/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, "Teste isolado de teclado 👇", {
    reply_markup: { inline_keyboard: [
      [{ text: "Abrir teste", web_app: { url: process.env.WEBAPP_URL + "/kbtest.html?v=" + Date.now() } }],
    ]},
  });
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
        { type: "SEND_PHOTO", chatId: String(chatId), data: { file: "photo_5102783828031376457_w.jpg", caption: "", instant: true } },
        { delay: 0, jobId: jid("conteudinhos", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "Tudo isso é seu, é só escolher por onde quer começar 🔥👇",
          noTyping: true,
          extra: { reply_markup: { inline_keyboard: [
            [{ text: "😈 CHAMADA DE VÍDEO AO VIVO 💦",    callback_data: "chamada_video",   style: "danger"  }],
            [{ text: "📸 VEM ME VER NO INSTA 👀",         callback_data: "abrir_instagram", style: "primary" }],
            [{ text: "💰 QUERO VER OS PLANOS 🔥",          callback_data: "ver_planos",      style: "success" }],
          ]}},
        }},
        { delay: 1000, jobId: jid("conteudinhos", chatId, 2), removeOnComplete: true, removeOnFail: true }
      );
      return;
    }

    // ── Instagram (mini app dedicado) ────────────────────────────────────────
    if (data === "abrir_instagram") {
      await bot.answerCallbackQuery(q.id, { text: "😈" }).catch(() => {});
      await queue.add("jobs",
        { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "IMG_7068.MP4", caption: "", instant: true } },
        { delay: 0, jobId: jid("instagram", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "<b>VEM VER MEU INSTAGRAM SEUS SAFADOS 😈👇🏽</b>",
          noTyping: true,
          extra: { parse_mode: "HTML", reply_markup: { inline_keyboard: [
            [{ text: "😈 Espiar meu Insta", web_app: { url: process.env.WEBAPP_URL + "/instagram/?v=" + Date.now() }, style: "success" }],
          ]}},
        }},
        { delay: 1000, jobId: jid("instagram", chatId, 2), removeOnComplete: true, removeOnFail: true }
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
        { type: "SEND_VIDEO", chatId: String(chatId), data: { file: "IMG_7529.MP4", caption: "", instant: true } },
        { delay: 0, jobId: jid("chamada_video", chatId, 1), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "Isso que você viu é só o começo, meu amor 😈💦\n\nLá dentro eu fico totalmente pelada e sem limites pra você: chat bem safado, videochamada gemendo ao vivo, fotos íntimas e uma surpresa bem quente que só quem entra vai descobrir… 🎁\n\nÉ exclusivo, bem safadinho e tá disponível só agora.\n\nVem logo, tô molhadinha te esperando… 😘",
          noTyping: true,
        }},
        { delay: 1000, jobId: jid("chamada_video", chatId, 2), removeOnComplete: true, removeOnFail: true }
      );
      await queue.add("jobs",
        { type: "SEND_MESSAGE", chatId: String(chatId), data: {
          text: "<b>VEM QUE EU TÔ SOZINHA E SAFADA TE ESPERANDO 😈📹</b>",
          noTyping: true,
          extra: { parse_mode: "HTML", reply_markup: { inline_keyboard: [
            [{ text: "ENTRAR NO PRIVADO 🔥", web_app: { url: process.env.WEBAPP_URL + "?v=" + Date.now() }, style: "success" }],
          ]}},
        }},
        { delay: 4500, jobId: jid("chamada_video", chatId, 3), removeOnComplete: true, removeOnFail: true }
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
      await bot.answerCallbackQuery(q.id).catch(() => {});
      await createCheckoutAndSend(chatId, data.split(":")[1]);
      return;
    }

  } catch (e) {
    console.error("callback error:", e);
    try { await bot.answerCallbackQuery(q.id, { text: "deu ruim aqui. tenta de novo." }); } catch {}
  }
});

console.log("bot v4 rodando...");
