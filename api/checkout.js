// api/checkout.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const apiBase = `https://api.telegram.org/bot${BOT_TOKEN}`;

  const tgSend = (text, extra = {}) =>
    fetch(`${apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, ...extra }),
    });

  const tgSendVideo = (videoUrl, extra = {}) =>
    fetch(`${apiBase}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), video: videoUrl, ...extra }),
    });

  const WEBAPP_URL = process.env.WEBAPP_URL || "https://alana-chat.vercel.app";

  try {
    await tgSendVideo(`${WEBAPP_URL}/assets/pagamento.mp4`);
    await tgSend("tá… agora escolhe como você quer entrar.");
    await tgSend("3 opções. sem enrolar.");
    await tgSend("👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🥉 GRUPO SEM CENSURA — R$ 14,90",        callback_data: "plan:basic" }],
          [{ text: "🥈 GRUPO + AO VIVO COMIGO — R$ 24,90",   callback_data: "plan:plus"  }],
          [{ text: "🥇 PRIVADO — SÓ EU E VOCÊ — R$ 34,90",   callback_data: "plan:vip"   }],
        ],
      },
    });
    await tgSend("✅ Pagamento confirmado = acesso liberado na hora!\n\nAssim que o Pix cair você recebe o link em menos de 30 segundos 🔒");

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
