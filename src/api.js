// src/api.js
require("dotenv").config();

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { queue } = require("./queue");
const { queue: queue2 } = require("./queue2");
const { mpGetPayment } = require("../payments/mp");

const prisma = new PrismaClient();
const app = express();

app.use(express.json());

app.get("/health", (_, res) => res.json({ ok: true }));

/**
 * MP webhook costuma vir como:
 * - query: ?type=payment&data.id=123  (ou ?topic=payment&id=123)
 * - body também pode ter { type, data: { id } }
 */
function extractPaymentId(req) {
  const q = req.query || {};
  const b = req.body || {};

  // query variants
  const qId = q["data.id"] || q["id"];
  if (qId) return String(qId);

  // body variants
  const bId = b?.data?.id || b?.id;
  if (bId) return String(bId);

  return null;
}

app.post("/webhook", async (req, res) => {
  // responde rápido pro MP
  res.sendStatus(200);

  try {
    const paymentId = extractPaymentId(req);
    if (!paymentId) {
      console.log("[webhook] no payment id", { query: req.query, body: req.body });
      return;
    }

    const payment = await mpGetPayment(paymentId);

    const status = payment.status; // approved, pending, rejected, etc.
    const chatId = payment.external_reference || payment.metadata?.chatId;
    const plano = payment.metadata?.plano;
    // `persona` vem do metadata setado em mpCreatePix (ver payments/mp.js) —
    // ausente = bot principal (comportamento de sempre); "m2" = segundo bot,
    // que usa fila e registros de usuário prefixados (ver bot2.js/worker2.js).
    const persona = payment.metadata?.persona;
    const dbUserId = persona ? `${persona}:${chatId}` : String(chatId);
    const targetQueue = persona === "m2" ? queue2 : queue;

    console.log("[webhook] payment", paymentId, status, chatId, persona || "(principal)");

    if (!chatId) return;

    // salva/atualiza Payment (ajuste nomes se seu schema difere)
    await prisma.payment.upsert({
      where: { id: String(paymentId) }, // se seu Payment.id não for paymentId, troque essa estratégia
      update: {
        status,
        plano: plano || undefined,
        userId: dbUserId,
      },
      create: {
        id: String(paymentId),
        userId: dbUserId,
        plano: plano || "unknown",
        status,
      },
    });

    if (status === "approved") {
      // marca user como pago/etapa
      await prisma.user.update({
        where: { id: dbUserId },
        data: { pagou: true, etapa: "pagamento" }, // ou "pos_pagamento" direto se preferir
      });

      // job pós pagamento — chatId aqui continua o número real do Telegram
      // (nunca prefixado), é o que o bot usa pra mandar a mensagem de verdade.
      await targetQueue.add(
        "jobs",
        { type: "POST_PAYMENT", chatId: String(chatId), data: { paymentId } },
        { jobId: `post_payment:${persona || "m1"}:${chatId}:${paymentId}`, removeOnComplete: true }
      );
    }
  } catch (e) {
    console.error("[webhook] error:", e);
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`[api] listening on :${port}`));