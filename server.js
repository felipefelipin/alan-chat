require("dotenv").config();

const express = require("express");
const path = require("path");
const { queue } = require("./src/queue");

const app = express();

// =======================
// Middlewares
// =======================
app.use(express.json());

// força não usar cache (essencial pro Telegram WebApp atualizar)
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// =======================
// STATIC (FRONTEND)
// =======================
// tudo vem da pasta /public
app.use(express.static(path.join(__dirname, "public")));

// =======================
// HEALTH CHECK
// =======================
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// =======================
// WEBHOOK (Telegram / futuro)
// =======================
app.post("/webhook", (req, res) => {
  console.log("Webhook recebido:", req.body);
  res.sendStatus(200);
});

// =======================
// API: checkout disparado pelo Mini App
// =======================
app.post("/api/checkout", async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: "missing chatId" });
    await queue.add(
      "jobs",
      { type: "SEND_PLANS", chatId: String(chatId), data: {} },
      { removeOnComplete: true, removeOnFail: true }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("/api/checkout error:", e);
    res.status(500).json({ error: "internal error" });
  }
});

// =======================
// FALLBACK (SPA)
// =======================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});