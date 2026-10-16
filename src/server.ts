import http from "node:http";
import { createApp } from "./app.js";
import { prisma } from "./config/database.js";
import { attachSocket } from "./config/socket.js";
import { env, isProduction } from "./config/env.js";
import { logger } from "./utils/logger.js";

if (isProduction && !env.COOKIE_SECURE) {
  logger.warn("COOKIE_SECURE=false en producción: la cookie de sesión viajará sin HTTPS.");
}

const server = http.createServer(createApp());
// Socket.IO comparte el servidor HTTP: /socket.io/ (pedidos en vivo del panel).
const live = attachSocket(server);

server.listen(env.PORT, () => {
  logger.info(`PedifyAI escuchando en el puerto ${env.PORT} (${env.APP_URL})`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Señal ${signal}: cerrando el servidor…`);
  await live.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
