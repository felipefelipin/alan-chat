// api/track.js — Vercel Serverless Function
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const { chatId, event, payload, persona } = req.body || {};
  if (!chatId || !event) return res.status(400).json({ error: "missing params" });

  // bot2 guarda tudo com o id prefixado "m2:<chatId>" (mesmo chatId do
  // Telegram existe nos dois bots, então precisa de namespace separado no
  // banco). Sem isso, todo tracking do mini app do bot2 ficava gravado
  // (ou lido) do registro errado — e o MINIAPP_OPEN abaixo nunca tirava o
  // usuário de "webapp_pending" de verdade, fazendo o PRE_NUDGE achar que
  // ele nunca abriu o mini app e mandar o lembrete mesmo quem já clicou.
  const dbUserId = persona === "m2" ? `m2:${chatId}` : String(chatId);

  try {
    // garante que o usuário existe antes de criar o evento
    await prisma.user.upsert({
      where: { id: dbUserId },
      update: {},
      create: { id: dbUserId, etapa: "unknown" },
    });

    await prisma.event.create({
      data: { userId: dbUserId, type: event, payload: payload ?? {} },
    });

    // Usuário realmente abriu o mini app principal — se ele ainda estava
    // "webapp_pending" (aguardando abrir, clicou em chamada_video), tira
    // desse estado pra PRE_NUDGE/REMARKETING pararem de mandar lembrete
    // pra quem já entrou. updateMany com where.etapa evita mexer em quem
    // já está em outro estágio (checkout, pagamento, etc).
    if (event === "MINIAPP_OPEN") {
      await prisma.user.updateMany({
        where: { id: dbUserId, etapa: "webapp_pending" },
        data: { etapa: "miniapp_aberto" },
      });
    }
  } catch (e) {
    console.error("track error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }

  res.json({ ok: true });
};
