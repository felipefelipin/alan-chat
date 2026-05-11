// api/checkout.js — Vercel Serverless Function
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { chatId } = req.body || {};
  if (!chatId) return res.status(400).json({ error: "missing chatId" });

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return res.status(500).json({ error: "no bot token" });

  const id = String(chatId);
  const base = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const assetsBase = `https://${req.headers.host}/assets`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const sendMsg = (text, extra = {}) =>
    fetch(`${base}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, parse_mode: "HTML", text, ...extra }),
    });

  const sendVideo = (video) =>
    fetch(`${base}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, video }),
    });

  // Responde imediatamente pro cliente (Mini App já fechou)
  // e continua enviando as mensagens em background
  res.json({ ok: true });

  try {
    // 1. Vídeo — lead começa aqui e desce
    await sendVideo(`${assetsBase}/checkout-video.mp4`);
    await sleep(900);

    // 2. Intro
    await sendMsg(
      `🔥 ATENÇÃO: VAGAS LIMITADAS HOJE\n\nTô aqui toda molhada te esperando...\n\nEscolhe agora e garante seu lugar no Ao Vivo + conteúdo particular.\n\n✅ <b>Pagamento confirmado = Liberação imediata</b>\n\nAssim que pagar, você entra no grupo ou recebe meu WhatsApp <b>em poucos segundos</b>.`
    );
    await sleep(700);

    // 3. Pacote 1
    await sendMsg(
      `🚀 <b>PACOTE 1 - ACESSO AO VIVO</b>\nR$ 29,90\n\n• Entrada imediata no grupo do Ao Vivo\n• 20 fotos exclusivas\n• Acesso durante toda a live`,
      { reply_markup: { inline_keyboard: [[{ text: "Entrar no Ao Vivo Agora", callback_data: "plan:basic" }]] } }
    );
    await sleep(700);

    // 4. Pacote 2
    await sendMsg(
      `💎 <b>PACOTE 2 - PREMIUM (MAIS ESCOLHIDO 🔥)</b>\nR$ 49,90\n\n• Tudo do Pacote 1\n• 40 fotos + 8 vídeos exclusivos\n• Prioridade nos comentários da live\n• Conteúdo extra após o Ao Vivo`,
      { reply_markup: { inline_keyboard: [[{ text: "Quero o Premium 🔥", callback_data: "plan:plus" }]] } }
    );
    await sleep(700);

    // 5. Pacote 3
    await sendMsg(
      `👑 <b>PACOTE 3 - VIP TOTAL (Mais Forte)</b>\nR$ 97,00\n\n• Tudo do Pacote 2\n• <b>Meu WhatsApp pessoal</b>\n• <b>Chamada de vídeo particular</b> (15 a 20 minutos peladinha só pra você)\n• Conteúdo exclusivo por 7 dias`,
      { reply_markup: { inline_keyboard: [[{ text: "Quero o VIP - WhatsApp + Chamada", callback_data: "plan:vip" }]] } }
    );
    await sleep(700);

    // 6. Rodapé
    await sendMsg(
      `⚡ <b>Entrega imediata após o pagamento!</b>\nAssim que confirmar o pagamento, você receberá o link do grupo ou meu WhatsApp <b>na hora</b>, em menos de 30 segundos. Sem espera.`
    );
  } catch (e) {
    console.error("checkout error:", e);
  }
};
