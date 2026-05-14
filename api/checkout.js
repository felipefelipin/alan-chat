// api/checkout.js — Vercel Serverless Function
const TelegramBot = require("node-telegram-bot-api");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const bot = new TelegramBot(BOT_TOKEN, { polling: false });
  const id  = String(chatId);
  const WEBAPP_URL = process.env.WEBAPP_URL || "https://alana-chat.vercel.app";

  try {
    // vídeo opcional — falha não bloqueia os botões
    try { await bot.sendVideo(id, `${WEBAPP_URL}/assets/pagamento.mp4`); } catch {}

    await bot.sendMessage(id, "tá… agora escolhe como você quer entrar.");
    await bot.sendMessage(id, "3 opções. sem enrolar.");
    await bot.sendMessage(id, "👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔥 GRUPO SEM CENSURA — R$ 14,90",        callback_data: "plan:basic",  style: "success" }],
          [{ text: "💦 GRUPO + AO VIVO COMIGO — R$ 24,90",   callback_data: "plan:plus",  style: "success" }],
          [{ text: "😈 PRIVADO — SÓ EU E VOCÊ — R$ 34,90",   callback_data: "plan:vip",   style: "success" }],
        ],
      },
    });
    await bot.sendMessage(id, "✅ Pagamento confirmado = acesso liberado na hora!\n\nAssim que o Pix cair você recebe o link em menos de 30 segundos 🔒");

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
