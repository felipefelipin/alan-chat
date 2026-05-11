// api/checkout.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId, plan } = req.body || {};
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

  const planMap = {
    basic: { label: "🚀 ACESSO AO VIVO — R$ 29,90", cb: "plan:basic" },
    plus:  { label: "💎 PREMIUM — R$ 49,90 🔥",     cb: "plan:plus"  },
    vip:   { label: "👑 VIP TOTAL — R$ 97,00",       cb: "plan:vip"   },
  };

  try {
    if (plan && planMap[plan]) {
      // Usuário já escolheu o plano no Mini App — confirma direto
      const chosen = planMap[plan];
      await tgSend(`você escolheu: ${chosen.label}`);
      await tgSend("confirma aqui para gerar o link de pagamento 👇", {
        reply_markup: {
          inline_keyboard: [[{ text: chosen.label, callback_data: chosen.cb }]],
        },
      });
    } else {
      // Fallback: envia os 3 planos
      await tgSend("tá… agora escolhe como você quer entrar.");
      await tgSend("3 opções. sem enrolar.");
      await tgSend("👇", {
        reply_markup: {
          inline_keyboard: [
            [{ text: planMap.basic.label, callback_data: planMap.basic.cb }],
            [{ text: planMap.plus.label,  callback_data: planMap.plus.cb  }],
            [{ text: planMap.vip.label,   callback_data: planMap.vip.cb   }],
          ],
        },
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed to send" });
  }
};
