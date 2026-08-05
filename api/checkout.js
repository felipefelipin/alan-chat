// api/checkout.js — Vercel Serverless Function
const TelegramBot = require("node-telegram-bot-api");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId, persona } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  // Sem isso, a mensagem de checkout do bot2 sempre saía pelo token do
  // bot1 — e como os botões de plano (callback_data "plan:...") só são
  // respondidos por quem os enviou, o clique também nunca chegava no
  // bot2, ficava tudo preso no bot1.
  const BOT_TOKEN = persona === "m2" ? process.env.BOT_TOKEN2 : process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const bot = new TelegramBot(BOT_TOKEN, { polling: false });
  const id  = String(chatId);
  const WEBAPP_URL = process.env.WEBAPP_URL || "https://alana-chat.vercel.app";

  // "digitando..." real do Telegram (sendChatAction) antes de cada
  // mensagem — tempo proporcional ao tamanho do texto, igual o resto do
  // funil já faz em worker.js. keepalive no fetch do mini app (ver
  // openCheckout em app.js) permite essa função demorar um pouco sem
  // travar nada visível pro lead.
  function typingDelayFor(text) {
    const len = String(text).length;
    return Math.min(4000, Math.max(1200, len * 45));
  }
  async function sendWithTyping(text, extra, msOverride) {
    try { await bot.sendChatAction(id, "typing"); } catch {}
    await new Promise((r) => setTimeout(r, msOverride ?? typingDelayFor(text)));
    await bot.sendMessage(id, text, extra);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    await sendWithTyping("Pronto meu bem, agora é só você escolher do jeito que vc quer continuar comigo");
    // "digitando" fixo em 7s nessa (em vez do cálculo automático por
    // tamanho do texto) — pedido explícito, pra dar mais peso antes da
    // foto/planos caírem.
    await sendWithTyping("Escolhe aí abaixo e vem terminar oq vc começou comigo safado 😈", undefined, 7000);

    await wait(2000);
    // foto opcional — falha não bloqueia o resto da sequência. Persona-
    // específica: bot2 usa a própria foto, bot1 mantém a de sempre.
    const checkoutPhoto = persona === "m2" ? "photo_4961127246739475602_y.jpg" : "4294967658 (1).jpeg";
    try { await bot.sendPhoto(id, `${WEBAPP_URL}/assets/${encodeURIComponent(checkoutPhoto)}`); } catch {}

    await wait(1000);
    await bot.sendMessage(id,
      "Acabei de me mostrar <b>peladinha</b> pra você… e eu vi no seu olhar que você ficou <b>duro pra caralho</b>. 😈\n" +
      "<b>Agora eu quero mais.</b>\n" +
      "Quero te ver me <b>fudendo com os olhos</b>, querendo me ouvir <b>gemer</b>, me ver <b>gozando e squirtando</b> só pra você. 💦\n" +
      "No meu <b>Espaço VIP</b> eu fico completamente à sua disposição:\n" +
      "<b>videochamada pelada</b> na hora que você quiser,\n" +
      "áudios bem <b>putinha</b> no seu ouvido,\n" +
      "fotos e vídeos íntimos que <b>ninguém mais vê</b>…\n" +
      "e todos os fetiches que te deixarem <b>doidinho</b>. 🔥\n" +
      "Sou <b>novinha</b>, carioca, carinhosa e <b>extremamente safada</b>.\n" +
      "Sem frescura.\n" +
      "<b>Sem limite.</b>\n" +
      "<b>Clica agora</b> e vem me comer do jeito que você sempre sonhou. 😈💋💋",
      { parse_mode: "HTML" }
    );

    await wait(1000);
    await bot.sendMessage(id, "👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👑 VIP ETERNO - R$5,90 - 25% OFF", callback_data: "plan:vip590", style: "success" }],
          [{ text: "📞 VIDEOCHAMADA PELADA - R$14,90 - 25% OFF", callback_data: "plan:videochamada", style: "danger" }],
          [{ text: "💞 NAMORO 7 DIAS - R$25,99 - 25% OFF", callback_data: "plan:namoro7dias", style: "primary" }],
        ],
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
