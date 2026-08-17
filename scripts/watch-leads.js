// scripts/watch-leads.js — painel de acompanhamento de leads em tempo real,
// direto no terminal. Só leitura (nunca escreve no banco). Ctrl+C pra sair.
//
// Redesenha a tela no lugar (como um "top") em vez de imprimir um bloco
// novo a cada atualização — por isso limpa e reescreve tudo a cada tick.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TICK_MS = 3000;
const MAX_ROWS = 25;
const MAX_RECENT_EVENTS = 12;

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
  if (type.includes("PAYMENT") || type === "PLAN_CLICK") return c.green;
  if (type.includes("REMARKETING") || type.includes("NUDGE")) return c.yellow;
  if (type.includes("MINIAPP")) return c.cyan;
  return c.dim;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[0f");
}

// Começa "agora", não do início dos tempos — o objetivo é acompanhar o que
// acontece dali pra frente, não reproduzir milhares de eventos antigos.
let lastEventCreatedAt = new Date();

// Último evento visto por lead — pra mostrar "o que essa pessoa fez por
// último" na tabela, não só a etapa (que muda com menos frequência).
const lastEventByUser = new Map();

// Buffer curto dos eventos mais recentes, pra mostrar como uma faixa fixa
// no rodapé do painel (redesenhada, não impressa linha a linha).
const recentEvents = [];

async function fetchNewEvents() {
  const events = await prisma.event.findMany({
    where: { createdAt: { gt: lastEventCreatedAt } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  for (const ev of events) {
    lastEventCreatedAt = ev.createdAt;
    lastEventByUser.set(ev.userId, ev.type);
    recentEvents.push(ev);
    if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
  }
}

async function render() {
  const [users, totalUsers, totalPaid] = await Promise.all([
    prisma.user.findMany({ orderBy: { updatedAt: "desc" }, take: MAX_ROWS }),
    prisma.user.count(),
    prisma.user.count({ where: { pagou: true } }),
  ]);

  const lines = [];
  lines.push(`${c.bold}${c.cyan}📡 Monitor de leads em tempo real${c.reset} ${c.dim}(atualiza sozinho — Ctrl+C pra sair)${c.reset}`);
  lines.push(`${c.dim}última atualização: ${new Date().toLocaleTimeString("pt-BR")}${c.reset}`);
  lines.push("");
  lines.push(`${c.bold}${c.magenta}══ Leads ══${c.reset}  ${c.bold}Total:${c.reset} ${totalUsers}  ${c.bold}${c.green}Pagos:${c.reset} ${totalPaid}`);
  lines.push(`${c.dim}${"CHAT ID".padEnd(14)} ${"ETAPA".padEnd(16)} ${"PAGOU".padEnd(6)} ${"ÚLTIMO EVENTO".padEnd(24)} ATUALIZADO${c.reset}`);
  for (const u of users) {
    const etapaColor = ETAPA_COLOR[u.etapa] || c.reset;
    const pagouTxt = u.pagou ? `${c.green}sim${c.reset}` : `${c.dim}não${c.reset}`;
    const lastEv = lastEventByUser.get(u.id) || "-";
    lines.push(
      `${u.id.padEnd(14)} ${etapaColor}${u.etapa.padEnd(16)}${c.reset} ${pagouTxt.padEnd(15)} ${lastEv.padEnd(24)} ${c.dim}${fmtAgo(u.updatedAt)}${c.reset}`
    );
  }

  lines.push("");
  lines.push(`${c.bold}${c.magenta}══ Últimos eventos ══${c.reset}`);
  if (recentEvents.length === 0) {
    lines.push(`${c.dim}(aguardando...)${c.reset}`);
  } else {
    for (const ev of recentEvents) {
      // MINIAPP_USER_REPLY ganha formato próprio — o que interessa aqui é
      // ler rápido o que o lead disse e A QUE mensagem ele respondeu, não
      // decifrar um JSON inline.
      if (ev.type === "MINIAPP_USER_REPLY") {
        const step = ev.payload?.step != null ? ` ${c.dim}(step ${ev.payload.step})${c.reset}` : "";
        const ctx  = ev.payload?.repliedTo ? ` ${c.dim}[resp. a: "${ev.payload.repliedTo}"]${c.reset}` : "";
        lines.push(`${c.dim}${fmtTime(ev.createdAt)}${c.reset} ${c.bold}${c.green}${"LEAD DISSE".padEnd(24)}${c.reset} lead:${ev.userId} "${ev.payload?.text ?? ""}"${step}${ctx}`);
        continue;
      }
      // SEND_START_SCREEN também ganha formato próprio — lista foto(s)/vídeo
      // enviados em vez de despejar o JSON bruto do payload.
      if (ev.type === "SEND_START_SCREEN") {
        const items = [
          ...(Array.isArray(ev.payload?.photos) ? ev.payload.photos.map((f) => `foto: ${f}`) : []),
          ...(ev.payload?.video ? [`vídeo: ${ev.payload.video}`] : []),
        ].join(", ");
        lines.push(`${c.dim}${fmtTime(ev.createdAt)}${c.reset} ${c.cyan}${"TELA 1 ENVIADA".padEnd(24)}${c.reset} lead:${ev.userId} ${c.dim}${items}${c.reset}`);
        continue;
      }
      const color = colorForEvent(ev.type);
      const hasPayload = ev.payload && Object.keys(ev.payload).length;
      const payload = hasPayload ? ` ${c.dim}${JSON.stringify(ev.payload)}${c.reset}` : "";
      lines.push(`${c.dim}${fmtTime(ev.createdAt)}${c.reset} ${color}${ev.type.padEnd(24)}${c.reset} lead:${ev.userId}${payload}`);
    }
  }

  clearScreen();
  console.log(lines.join("\n"));
}

async function tick() {
  await fetchNewEvents();
  await render();
}

async function main() {
  await tick();
  setInterval(() => tick().catch((e) => console.error("tick error:", e.message)), TICK_MS);
}

main().catch((e) => { console.error(e); process.exit(1); });
