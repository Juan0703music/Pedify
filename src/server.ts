import http from "node:http";
import { createApp } from "./app.js";
import { prisma } from "./config/database.js";
import { attachSocket } from "./config/socket.js";
import { env, environmentName, isProduction } from "./config/env.js";
import { productionWarnings } from "./config/readiness.js";
import { receiptReader } from "./services/receipt-reader.service.js";
import { logger } from "./utils/logger.js";

if (isProduction) {
  for (const warning of productionWarnings()) logger.warn(`Configuración pendiente: ${warning}`);
}

// Un error no controlado deja el proceso en un estado desconocido: se registra y se sale
// para que Docker (restart: unless-stopped) lo reinicie limpio.
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Error no controlado: el proceso se reinicia");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Promesa rechazada sin manejar: el proceso se reinicia");
  process.exit(1);
});

const server = http.createServer(createApp());
// Socket.IO comparte el servidor HTTP: /socket.io/ (pedidos en vivo del panel).
const live = attachSocket(server);

server.listen(env.PORT, () => {
  logger.info(`Pedify (${environmentName}) escuchando en el puerto ${env.PORT} (${env.APP_URL})`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Señal ${signal}: cerrando el servidor…`);
  // Docker espera 10 s antes de forzar el cierre; si algo se queda colgado, salimos antes.
  setTimeout(() => process.exit(1), 8_000).unref();
  await live.close();
  server.close();
  server.closeIdleConnections();
  await receiptReader.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
