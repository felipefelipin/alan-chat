// src/queue.js
const { Queue } = require("bullmq");

function parseRedisUrl(url) {
  // BullMQ aceita connection como { host, port, password } ou ioredis instance.
  // Vamos suportar REDIS_URL=redis://localhost:6379
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? u.password : undefined,
    maxRetriesPerRequest: null,
  };
}

const connection = parseRedisUrl(process.env.REDIS_URL || "redis://localhost:6379");

const queue = new Queue("jobs", { connection });

module.exports = { queue, connection };