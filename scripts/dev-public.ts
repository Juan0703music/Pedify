/**
 * Servidor de desarrollo con un enlace público, para probar desde cualquier celular (con Wi-Fi o datos).
 *
 *   npm run dev:public
 *
 * Abre un túnel temporal de Cloudflare (https://….trycloudflare.com, sin cuenta) hacia este computador y
 * arranca `npm run dev` con PUBLIC_URL apuntando a él: los QR de la tienda y de las mesas, el enlace del
 * domiciliario y el QR de la app lo usan. El enlace cambia cada vez y se apaga con Ctrl+C. Mientras está
 * encendido, cualquiera con el enlace ve las tiendas; el panel sigue pidiendo usuario y contraseña.
 *
 * Requiere `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

if (existsSync(".env")) process.loadEnvFile(".env");
const PORT = Number(process.env.PORT ?? 3000);
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const WAIT_MS = 45_000;

const children: ChildProcess[] = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3_000).unref();
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

const tunnel = spawn(process.env.CLOUDFLARED ?? "cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], {
  stdio: ["ignore", "ignore", "pipe"],
});
children.push(tunnel);
tunnel.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "ENOENT"
      ? "No se encontró cloudflared. Instálalo (ver el comentario de scripts/dev-public.ts) o indica su ruta en CLOUDFLARED."
      : `No se pudo abrir el túnel: ${error.message}`,
  );
  stop(1);
});
tunnel.on("exit", (code) => {
  if (!stopping) console.error(`El túnel se cerró (código ${code}).`);
  stop(code ?? 1);
});

const publicUrl = await new Promise<string>((resolve) => {
  const timer = setTimeout(() => {
    console.error("El túnel no entregó un enlace a tiempo. Revisa la conexión a internet e intenta de nuevo.");
    stop(1);
  }, WAIT_MS);
  createInterface({ input: tunnel.stderr! }).on("line", (line) => {
    const match = TUNNEL_URL.exec(line);
    if (match) {
      clearTimeout(timer);
      resolve(match[0]);
    }
  });
});

console.log(`\nEnlace público: ${publicUrl}\nLos QR de la tienda y de las mesas abren desde cualquier celular. Ctrl+C para apagarlo.\n`);

const dev = spawn("npm", ["run", "dev"], { stdio: "inherit", env: { ...process.env, PUBLIC_URL: publicUrl } });
children.push(dev);
dev.on("exit", (code) => stop(code ?? 0));
