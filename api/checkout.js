// api/checkout.js — Vercel Serverless Function
// Called by the Mini App when user clicks "Desbloquear Acesso".
// Sends the plan selection buttons directly via Telegram Bot API.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const base = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  const tgSend = (text, extra = {}) =>
    fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, ...extra }),
    });

  try {
    await tgSend("tá… agora escolhe como você quer entrar.");
    await tgSend("3 opções. sem enrolar.");
    await tgSend("👇", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 ACESSO AO VIVO — R$ 29,90", callback_data: "plan:basic" }],
          [{ text: "💎 PREMIUM — R$ 49,90 🔥",     callback_data: "plan:plus"  }],
          [{ text: "👑 VIP TOTAL — R$ 97,00",       callback_data: "plan:vip"   }],
        ],
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed to send" });
  }
};
