require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json());

// ✅ (1) Desabilita cache forte pra evitar vídeo antigo (principalmente em dev)
app.use((req, res, next) => {
  // pra arquivos grandes (mp4/mp3), evita cache agressivo durante testes
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// ✅ (2) Servir ASSETS no ROOT: /assets/...
app.use("/assets", express.static(path.join(__dirname, "assets")));

// ✅ (3) Servir o WebApp: /webapp/...
app.use("/webapp", express.static(path.join(__dirname, "webapp")));

// ✅ Webhook (Mercado Pago vai bater aqui)
app.post("/webhook", (req, res) => {
  console.log("Webhook recebido:", req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor HTTP rodando em http://localhost:${PORT}`));