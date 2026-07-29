
// src/queue2.js — fila separada pro segundo bot/modelo, mesma lógica do
// queue.js original, só com nome de fila diferente ("jobs2") pra nunca
// competir/misturar jobs com o bot principal.
const { Queue } = require("bullmq");

function parseRedisUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? u.password : undefined,
    maxRetriesPerRequest: null,
  };
}

const connection = parseRedisUrl(process.env.REDIS_URL || "redis://localhost:6379");

const queue2 = new Queue("jobs2", { connection });

module.exports = { queue: queue2, connection };
