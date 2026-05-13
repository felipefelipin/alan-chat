// api/checkout.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const id     = String(chatId);
  const base   = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const ASSETS = (process.env.PUBLIC_ASSETS_BASE || "https://alana-chat.vercel.app/assets").replace(/\/+$/, "");
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

  const tg = (method, body) =>
    fetch(`${base}/${method}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    }).then(r => r.json()).catch(() => ({}));

  try {
    // 1. Vídeo — tenta file_id primeiro (mais rápido), fallback pra URL
    await tg("sendChatAction", { chat_id: id, action: "upload_video" });
    const videoSrc = process.env.CHECKOUT_VIDEO_FILE_ID || `${ASSETS}/checkout-video.mp4`;
    const videoResult = await tg("sendVideo", {
      chat_id: id,
      video: videoSrc,
      supports_streaming: true,
    });
    if (!videoResult.ok) console.error("sendVideo failed:", JSON.stringify(videoResult));

    // 2. Typing antes da mensagem promocional
    await sleep(1800);
    await tg("sendChatAction", { chat_id: id, action: "typing" });
    await sleep(1800);

    // 3. Mensagem promocional
    await tg("sendMessage", {
      chat_id: id,
      parse_mode: "HTML",
      text: `🔥 <b>EU PAREÇO INOCENTE... MAS NÃO SOU 😈</b>\n\nCresci sendo vista como a boa moça, carinha de anjinho...\nMas no fundo eu sou uma safada que adora ficar peladinha, rebolando gostoso, abrindo as pernas e gemendo alto na frente de homem de verdade 💦\n\nAgora eu mostro tudinho: bucetinha molhada, sentando gostoso, gozando de verdade e fazendo tudo que você mandar...\n\nDeixa eu te contar o que te espera no meu cantinho VIP:\n\n🔥 Acesso TOTAL sem censura (fotos e vídeos explícitos)\n🔥 Ao Vivo interativo: eu faço tudo que você pedir\n🔥 Chamadas de vídeo particulares peladinha\n🎁 Bônus: sorteios e conteúdo extra pra quem é VIP\n\nSe você sempre quis ver essa putinha fingida de santinha gemendo seu nome... essa é a hora, safado 🔥💦\n\n<b>VEM DESVENDAR MEU SEGREDINHO 😈</b>`,
    });

    // 4. Tabela de valores
    await sleep(1200);
    await tg("sendMessage", {
      chat_id: id,
      text: "👇 Escolhe seu plano:",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔥 GRUPO SEM CENSURA — R$ 29,90",             callback_data: "plan:basic"                   }],
          [{ text: "💦 GRUPO + AO VIVO COMIGO — R$ 49,90",       callback_data: "plan:plus",  style: "success" }],
          [{ text: "😈 PRIVADO — SÓ EU E VOCÊ — R$ 97,00",       callback_data: "plan:vip"                    }],
        ],
      },
    });

    // 5. Mensagem de liberação pós-pagamento
    await sleep(1000);
    await tg("sendMessage", {
      chat_id: id,
      text: "✅ Pagamento confirmado = liberação na hora!\n\nAssim que o pagamento for aprovado você recebe o acesso em menos de 5 minutos 🔒",
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("checkout error:", e);
    res.status(500).json({ error: "failed" });
  }
};
