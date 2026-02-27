// payments/mp.js
require("dotenv").config();

async function mpCreatePreference({ chatId, plano }) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN missing");

  // ajuste preços/itens como quiser
  const plans = {
    basic: { title: "plano basic", price: 19.9 },
    plus: { title: "plano plus", price: 39.9 },
    vip: { title: "plano vip", price: 79.9 },
  };

  const chosen = plans[plano];
  if (!chosen) throw new Error("invalid plano");

  const body = {
    items: [
      {
        title: chosen.title,
        quantity: 1,
        unit_price: chosen.price,
        currency_id: "BRL",
      },
    ],
    external_reference: String(chatId),
    notification_url: process.env.WEBHOOK_URL, // ex: https://xxxx.ngrok-free.dev/webhook
    auto_return: "approved",
    back_urls: {
      success: "https://example.com/success",
      pending: "https://example.com/pending",
      failure: "https://example.com/failure",
    },
    metadata: { chatId: String(chatId), plano },
  };

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`mp preference error: ${res.status} ${JSON.stringify(json)}`);
  }

  return {
    preferenceId: json.id,
    initPoint: json.init_point,
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

module.exports = { mpCreatePreference, mpGetPayment };