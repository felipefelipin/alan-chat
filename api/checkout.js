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
    // foto opcional — falha não bloqueia a mensagem/botão
    try { await bot.sendPhoto(id, `${WEBAPP_URL}/assets/photo_5102783828031376538_y.jpg`); } catch {}

    await bot.sendMessage(id,
      "Se você está aqui… é porque acabou de me ver peladinha e eu sei que você gostou bastante 😈💗\n\n" +
      "Como recompensa por ter sido tão safadinho comigo, te dei um presentão:\n\n" +
      "🎁 <b>Acesso vitalício ao meu Espaço VIP por apenas R$ 5,90</b>\n\n" +
      "Lá dentro sou toda sua… sem limites e sem frescura. Podemos fazer videochamada pelada sempre que você quiser, áudios gemendo bem baixinho no seu ouvido, fotos e vídeos bem íntimos, squirt ao vivo, fetiches e tudo que te deixar louquinho.\n\n" +
      "Sou uma novinha carioca carinhosa, safada e sempre molhadinha… viciada em dar prazer e receber carinho de um homem que sabe o que quer.\n\n" +
      "Vem pra cá, meu amor… quero continuar te mostrando meu lado mais quente e safado. 💦\n\n" +
      "<b>Clica agora e entra no meu mundinho particular</b> 😘",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "😈 ENTRAR NO MEU VIP — R$ 5,90", callback_data: "plan:vip590", style: "success" }],
          ],
        },
      }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
