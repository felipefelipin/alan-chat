require("dotenv").config();

const express = require("express");
const path = require("path");

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