import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    uploadsDir: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Base de datos de pruebas:
 * - Si existe TEST_DATABASE_URL (CI, Docker), se usa esa base.
 * - Si no, se levanta un PostgreSQL temporal que se elimina al terminar.
 * En ambos casos se aplican las migraciones antes de las pruebas.
 */
export default async function setup(project: TestProject) {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  let teardown = async () => {};

  if (!databaseUrl) {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "pedifyai-test-"));
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("pedifyai_test");
    databaseUrl = `postgresql://postgres:postgres@localhost:${port}/pedifyai_test`;
    teardown = async () => {
      await pg.stop();
      rmSync(dataDir, { recursive: true, force: true });
    };
  }

  execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  // Carpeta temporal para las imágenes subidas durante las pruebas.
  const uploadsDir = mkdtempSync(path.join(os.tmpdir(), "pedifyai-uploads-"));

  project.provide("databaseUrl", databaseUrl);
  project.provide("uploadsDir", uploadsDir);
  return async () => {
    rmSync(uploadsDir, { recursive: true, force: true });
    await teardown();
  };
}
