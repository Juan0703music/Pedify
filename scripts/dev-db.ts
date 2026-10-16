/**
 * PostgreSQL local para desarrollo sin Docker.
 *
 *   npm run db:start
 *
 * Levanta un servidor PostgreSQL real (paquete embedded-postgres) con los datos en `.pgdata/`
 * y crea la base `pedifyai` si no existe. Se detiene con Ctrl+C.
 * Con Docker disponible, `docker compose up db` cumple la misma función.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const DATABASE = "pedifyai";
const dataDir = path.resolve(".pgdata");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
  onLog: () => {},
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("Inicializando PostgreSQL en .pgdata/ …");
  await pg.initialise();
}

await pg.start();

const client = pg.getPgClient();
await client.connect();
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE]);
if (!rowCount) await pg.createDatabase(DATABASE);
await client.end();

console.log(`PostgreSQL listo: postgresql://postgres:postgres@localhost:${PORT}/${DATABASE}`);
console.log("Ctrl+C para detenerlo.");

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
