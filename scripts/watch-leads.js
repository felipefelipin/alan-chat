// scripts/watch-leads.js — painel de acompanhamento de leads em tempo real,
// direto no terminal. Só leitura (nunca escreve no banco). Ctrl+C pra sair.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const POLL_MS = 3000;
const TABLE_EVERY_MS = 10000;
const MAX_ROWS = 25;

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m", red: "\x1b[31m",
};

const ETAPA_COLOR = {
  engajado: c.dim,
  webapp_pending: c.yellow,
  checkout: c.cyan,
  pagamento: c.magenta,
  pos_pagamento: c.green,
};

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("pt-BR", { hour12: false });
}

function fmtAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

function colorForEvent(type) {
  if (type.includes("PAYMENT")) return c.green;
  if (type.includes("REMARKETING") || type.includes("NUDGE")) return c.yellow;
  if (type.includes("MINIAPP")) return c.cyan;
  return c.dim;
}

// Começa "agora", não do início dos tempos — o objetivo é acompanhar o que
// acontece dali pra frente, não reproduzir milhares de eventos antigos.
let lastEventCreatedAt = new Date();

// Último evento visto por lead — pra mostrar "o que essa pessoa fez por
// último" na tabela, não só a etapa (que muda com menos frequência).
const lastEventByUser = new Map();

async function printLeadTable() {
  const users = await prisma.user.findMany({
    orderBy: { updatedAt: "desc" },
    take: MAX_ROWS,
  });
  const totalUsers = await prisma.user.count();
  const totalPaid = await prisma.user.count({ where: { pagou: true } });

  console.log(`\n${c.bold}${c.magenta}══ Leads (${new Date().toLocaleTimeString("pt-BR")}) ══${c.reset}  ${c.bold}Total:${c.reset} ${totalUsers}  ${c.bold}${c.green}Pagos:${c.reset} ${totalPaid}`);
  console.log(
    `${c.dim}${"CHAT ID".padEnd(14)} ${"ETAPA".padEnd(16)} ${"PAGOU".padEnd(6)} ${"ÚLTIMO EVENTO".padEnd(20)} ATUALIZADO${c.reset}`
  );
  for (const u of users) {
    const etapaColor = ETAPA_COLOR[u.etapa] || c.reset;
    const pagouTxt = u.pagou ? `${c.green}sim${c.reset}` : `${c.dim}não${c.reset}`;
    const lastEv = lastEventByUser.get(u.id) || "-";
    console.log(
      `${u.id.padEnd(14)} ${etapaColor}${u.etapa.padEnd(16)}${c.reset} ${pagouTxt.padEnd(15)} ${lastEv.padEnd(20)} ${c.dim}${fmtAgo(u.updatedAt)}${c.reset}`
    );
  }
  console.log("");
}

async function pollEvents() {
  const events = await prisma.event.findMany({
    where: { createdAt: { gt: lastEventCreatedAt } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const ev of events) {
    lastEventCreatedAt = ev.createdAt;
    lastEventByUser.set(ev.userId, ev.type);
    const color = colorForEvent(ev.type);
    const hasPayload = ev.payload && Object.keys(ev.payload).length;
    const payload = hasPayload ? ` ${c.dim}${JSON.stringify(ev.payload)}${c.reset}` : "";
    console.log(`${c.dim}${fmtTime(ev.createdAt)}${c.reset} ${color}${ev.type.padEnd(24)}${c.reset} lead:${ev.userId}${payload}`);
  }
}

async function main() {
  console.log(`${c.bold}${c.cyan}📡 Monitor de leads em tempo real — Ctrl+C para sair${c.reset}\n`);
  await pollEvents(); // popula lastEventByUser antes da 1ª tabela
  await printLeadTable();
  setInterval(() => pollEvents().catch((e) => console.error("poll error:", e.message)), POLL_MS);
  setInterval(() => printLeadTable().catch((e) => console.error("table error:", e.message)), TABLE_EVERY_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
