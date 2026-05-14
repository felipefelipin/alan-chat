// payments/mp.js
require("dotenv").config();

const crypto = require("crypto");

const PLANS = {
  basic: { title: "Grupo Sem Censura",      price: 14.90 },
  plus:  { title: "Grupo + Ao Vivo",        price: 24.90 },
  vip:   { title: "Privado — Só Eu e Você", price: 34.90 },
};

async function mpCreatePix({ chatId, plano }) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN missing");

  const chosen = PLANS[plano];
  if (!chosen) throw new Error("invalid plano: " + plano);

  const body = {
    transaction_amount: chosen.price,
    description:        chosen.title,
    payment_method_id:  "pix",
    payer: {
      email: `user${chatId}@pixbot.com`,
    },
    external_reference: String(chatId),
    metadata: { chatId: String(chatId), plano },
  };

  const res = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization:       `Bearer ${accessToken}`,
      "Content-Type":      "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`mp pix error: ${res.status} ${JSON.stringify(json)}`);
  }

  const txData = json.point_of_interaction?.transaction_data;
  if (!txData) throw new Error("mp pix: no transaction_data in response");

  return {
    paymentId:   String(json.id),
    pixCode:     txData.qr_code,
    pixQrBase64: txData.qr_code_base64,
    status:      json.status,
    amount:      chosen.price,
    plano,
  };
}

async function mpGetPayment(paymentId) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`mp get payment error: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

module.exports = { mpCreatePix, mpGetPayment };
