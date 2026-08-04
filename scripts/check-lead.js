// scripts/check-lead.js — histórico completo de um lead específico, direto
// no terminal. Só leitura. Uso: node scripts/check-lead.js <chatId>
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", magenta: "\x1b[35m",
};

function fmtTime(d) {
  return new Date(d).toLocaleString("pt-BR", { hour12: false });
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("uso: node scripts/check-lead.js <chatId>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    console.log(`${c.yellow}Nenhum registro encontrado pro chatId ${id}${c.reset}`);
    await prisma.$disconnect();
    return;
  }

  console.log(`${c.bold}${c.cyan}Lead ${id}${c.reset}`);
  console.log(`  etapa:      ${c.bold}${user.etapa}${c.reset}`);
  console.log(`  pagou:      ${user.pagou ? c.green + "sim" : "não"}${c.reset}`);
  console.log(`  criado em:  ${c.dim}${fmtTime(user.createdAt)}${c.reset}`);
  console.log(`  atualizado: ${c.dim}${fmtTime(user.updatedAt)}${c.reset}`);

  const events = await prisma.event.findMany({
    where: { userId: id },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n${c.bold}${c.magenta}══ Linha do tempo (${events.length} eventos) ══${c.reset}`);
  for (const e of events) {
    if (e.type === "MINIAPP_USER_REPLY") {
      const step = e.payload?.step != null ? ` ${c.dim}(step ${e.payload.step})${c.reset}` : "";
      if (e.payload?.repliedTo) {
        console.log(`${c.dim}${fmtTime(e.createdAt)}${c.reset}  ${c.dim}respondendo a: "${e.payload.repliedTo}"${c.reset}`);
      }
      console.log(`${c.dim}${fmtTime(e.createdAt)}${c.reset}  ${c.bold}${c.green}LEAD DISSE:${c.reset} "${e.payload?.text ?? ""}"${step}`);
      continue;
    }
    const payload = e.payload && Object.keys(e.payload).length ? ` ${c.dim}${JSON.stringify(e.payload)}${c.reset}` : "";
    console.log(`${c.dim}${fmtTime(e.createdAt)}${c.reset}  ${c.cyan}${e.type}${c.reset}${payload}`);
  }

  const replies = events.filter((e) => e.type === "MINIAPP_USER_REPLY");
  if (replies.length) {
    console.log(`\n${c.bold}${c.magenta}══ Só as respostas do lead (${replies.length}) ══${c.reset}`);
    for (const e of replies) {
      const step = e.payload?.step != null ? ` ${c.dim}(step ${e.payload.step})${c.reset}` : "";
      const ctx  = e.payload?.repliedTo ? `\n    ${c.dim}↳ respondendo a: "${e.payload.repliedTo}"${c.reset}` : "";
      console.log(`${c.dim}${fmtTime(e.createdAt)}${c.reset}  ${c.green}"${e.payload?.text ?? ""}"${c.reset}${step}${ctx}`);
    }
  }

  if (events.length) {
    console.log(`\n${c.bold}Último evento: ${c.yellow}${events[events.length - 1].type}${c.reset} ${c.dim}(${fmtTime(events[events.length - 1].createdAt)})${c.reset}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
