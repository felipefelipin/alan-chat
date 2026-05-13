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
    await tg("sendMessage", {
      chat_id: id,
      parse_mode: "HTML",
      text: `🔥 <b>EU PAREÇO INOCENTE... MAS NÃO SOU 😈</b>\n\nCresci sendo vista como a boa moça, carinha de anjinho...\nMas no fundo eu sou uma safada que adora ficar peladinha, rebolando gostoso, abrindo as pernas e gemendo alto na frente de homem de verdade 💦\n\nAgora eu mostro tudinho: bucetinha molhada, sentando gostoso, gozando de verdade e fazendo tudo que você mandar...\n\nDeixa eu te contar o que te espera no meu cantinho VIP:\n\n🔥 Acesso TOTAL sem censura (fotos e vídeos explícitos)\n🔥 Ao Vivo interativo: eu faço tudo que você pedir\n🔥 Chamadas de vídeo particulares peladinha\n🎁 Bônus: sorteios e conteúdo extra pra quem é VIP\n\nSe você sempre quis ver essa putinha fingida de santinha gemendo seu nome... essa é a hora, safado 🔥💦\n\n<b>VEM DESVENDAR MEU SEGREDINHO 😈</b>`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 ACESSO AO VIVO — R$ 29,90", callback_data: "plan:basic" }],
          [{ text: "💎 PREMIUM — R$ 49,90 🔥",      callback_data: "plan:plus"  }],
          [{ text: "👑 VIP TOTAL — R$ 97,00",        callback_data: "plan:vip"   }],
        ],
      },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
