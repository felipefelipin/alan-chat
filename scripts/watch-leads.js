// scripts/watch-leads.js — painel de acompanhamento de leads em tempo real,
// direto no terminal. Só leitura (nunca escreve no banco). Ctrl+C pra sair.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const POLL_MS = 3000;
const SUMMARY_EVERY_MS = 20000;

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m",
};

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("pt-BR", { hour12: false });
}

function colorForEvent(type) {
  if (type.includes("PAYMENT")) return c.green;
  if (type.includes("REMARKETING") || type.includes("NUDGE")) return c.yellow;
  if (type.includes("MINIAPP")) return c.cyan;
  return c.dim;
}

let lastEventCreatedAt = new Date(0);

async function printSummary() {
  const [byEtapa, totalUsers, totalPaid] = await Promise.all([
    prisma.user.groupBy({ by: ["etapa"], _count: { etapa: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { pagou: true } }),
  ]);
  console.log(`\n${c.bold}${c.magenta}── Resumo (${new Date().toLocaleTimeString("pt-BR")}) ──${c.reset}`);
  console.log(`${c.bold}Total de leads:${c.reset} ${totalUsers}   ${c.bold}${c.green}Pagos:${c.reset} ${totalPaid}`);
  for (const row of byEtapa.sort((a, b) => b._count.etapa - a._count.etapa)) {
    console.log(`  ${row.etapa.padEnd(20)} ${c.bold}${row._count.etapa}${c.reset}`);
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
    const color = colorForEvent(ev.type);
    const hasPayload = ev.payload && Object.keys(ev.payload).length;
    const payload = hasPayload ? ` ${c.dim}${JSON.stringify(ev.payload)}${c.reset}` : "";
    console.log(`${c.dim}${fmtTime(ev.createdAt)}${c.reset} ${color}${ev.type.padEnd(24)}${c.reset} lead:${ev.userId}${payload}`);
  }
}

async function main() {
  console.log(`${c.bold}${c.cyan}📡 Monitor de leads em tempo real — Ctrl+C para sair${c.reset}\n`);
  await printSummary();
  setInterval(() => pollEvents().catch((e) => console.error("poll error:", e.message)), POLL_MS);
  setInterval(() => printSummary().catch((e) => console.error("summary error:", e.message)), SUMMARY_EVERY_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
