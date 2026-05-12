// api/checkout.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const id   = String(chatId);
  const base = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const ASSETS = (process.env.PUBLIC_ASSETS_BASE || "https://alana-chat.vercel.app/assets").replace(/\/+$/, "");

  const tg = (method, body) =>
    fetch(`${base}/${method}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }).then(r => r.json()).catch(() => ({}));

  try {
    await tg("sendVideo", { chat_id: id, video: `${ASSETS}/checkout-video.mp4` });

    await tg("sendMessage", { chat_id: id, text: "tá… agora escolhe como você quer entrar." });
    await tg("sendMessage", { chat_id: id, text: "3 opções. sem enrolar." });

    await tg("sendMessage", {
      chat_id: id,
      text: "👇",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 ACESSO AO VIVO — R$ 29,90", callback_data: "plan:basic" }],
          [{ text: "💎 PREMIUM — R$ 49,90 🔥",      callback_data: "plan:plus"  }],
          [{ text: "👑 VIP TOTAL — R$ 97,00",        callback_data: "plan:vip"   }],
        ],
      },
    });

    await tg("sendMessage", {
      chat_id: id,
      text: "✅ Pagamento confirmado = Liberação na hora!\nAssim que o pagamento for aprovado você recebe o link do grupo ou meu WhatsApp em menos de 30 minutos.",
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
