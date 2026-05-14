// api/track.js — Vercel Serverless Function
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).end();

  const { chatId, event } = req.body || {};
  if (!chatId || !event) return res.status(400).json({ error: "missing params" });

  try {
    // garante que o usuário existe antes de criar o evento
    await prisma.user.upsert({
      where: { id: String(chatId) },
      update: {},
      create: { id: String(chatId), etapa: "unknown" },
    });

    await prisma.event.create({
      data: { userId: String(chatId), type: event, payload: {} },
    });
  } catch (e) {
    console.error("track error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }

  res.json({ ok: true });
};
