/**
 * Verificación de un despliegue, de afuera hacia adentro. Solo lee: no crea cuentas, pedidos ni datos.
 *
 *   npm run smoke -- https://pedifyai.com
 *   npm run smoke -- http://localhost:3000
 *
 * Revisa salud y base de datos, páginas, cabeceras de seguridad, CSS de producción, compresión,
 * redirección a HTTPS y certificado, rutas protegidas, robots.txt y el canal en vivo (Socket.IO por
 * polling y por WebSocket, que es lo que suele romperse en el proxy). Sale con código 1 si algo falla.
 */
import tls from "node:tls";

const target = process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000";
const base = new URL(target);
const isHttps = base.protocol === "https:";
const TIMEOUT_MS = 10_000;

type Outcome = { ok: boolean; name: string; detail: string };
const outcomes: Outcome[] = [];
let environment = "desconocido";

class CheckError extends Error {}
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckError(message);
}

const get = (path: string, init: RequestInit = {}) =>
  fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });

async function check(name: string, run: () => Promise<string | void>) {
  try {
    outcomes.push({ ok: true, name, detail: (await run()) ?? "" });
  } catch (error) {
    const detail = error instanceof CheckError ? error.message : `${(error as Error).name}: ${(error as Error).message}`;
    outcomes.push({ ok: false, name, detail });
  }
}

/** Primer mensaje de un WebSocket (o error si no llega a tiempo). */
function webSocketExchange(url: string, send?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: string[] = [];
    const timer = setTimeout(() => {
      socket.close();
      messages.length ? resolve(messages) : reject(new CheckError("El WebSocket no respondió (¿el proxy reenvía Upgrade/Connection?)."));
    }, 5_000);
    socket.addEventListener("message", (event) => {
      messages.push(String(event.data));
      if (messages.length === 1 && send) socket.send(send);
      if (messages.length === (send ? 2 : 1)) {
        clearTimeout(timer);
        socket.close();
        resolve(messages);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new CheckError("No se pudo abrir el WebSocket (¿el proxy reenvía Upgrade/Connection?)."));
    });
  });
}

function certificateExpiry(host: string, port: number): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: TIMEOUT_MS }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      resolve(new Date(certificate.valid_to));
    });
    socket.on("error", reject);
    socket.on("timeout", () => socket.destroy(new Error("Tiempo de espera agotado")));
  });
}

await check("Salud y base de datos", async () => {
  const res = await get("/api/v1/health");
  const body = (await res.json().catch(() => null)) as {
    data?: { status: string; version: string; environment?: string; database: { status: string; latencyMs?: number } };
  } | null;
  const data = body?.data;
  ensure(res.status === 200 && data?.status === "ok", `Respondió ${res.status}: ${JSON.stringify(data ?? body)}`);
  environment = data.environment ?? environment;
  return `versión ${data.version} · ${environment} · base de datos ${data.database.latencyMs} ms`;
});

let landingHeaders: Headers | null = null;
await check("Portada", async () => {
  const res = await get("/");
  const html = await res.text();
  ensure(res.status === 200, `Respondió ${res.status}`);
  ensure(res.headers.get("content-type")?.includes("text/html"), "No es HTML");
  ensure(html.includes("PedifyAI"), "No parece la portada de PedifyAI");
  landingHeaders = res.headers;
});

await check("Cabeceras de seguridad", async () => {
  ensure(landingHeaders, "Sin respuesta de la portada");
  const headers = landingHeaders as Headers;
  const missing = ["content-security-policy", "x-content-type-options", "referrer-policy"].filter((name) => !headers.get(name));
  if (isHttps && !headers.get("strict-transport-security")) missing.push("strict-transport-security (¿COOKIE_SECURE=true?)");
  ensure(missing.length === 0, `Faltan: ${missing.join(", ")}`);
  ensure(!headers.get("x-powered-by"), "La respuesta revela X-Powered-By");
  return isHttps ? "CSP, HSTS, nosniff y Referrer-Policy" : "CSP, nosniff y Referrer-Policy (sin HTTPS no se envía HSTS)";
});

await check("Estilos de producción", async () => {
  const res = await get("/css/app.css", { headers: { "accept-encoding": "gzip, br" } });
  const css = await res.text();
  ensure(res.status === 200, `Respondió ${res.status} (¿se ejecutó npm run build?)`);
  ensure(css.length > 10_000, "El CSS está casi vacío");
  ensure(css.split("\n").length < 40, "El CSS no está minificado (npm run build:css)");
  const encoding = res.headers.get("content-encoding");
  if (isHttps) ensure(encoding, "El proxy no comprime las respuestas (encode zstd gzip en Caddy)");
  return `${Math.round(css.length / 1024)} KB${encoding ? `, comprimido (${encoding})` : ""}`;
});

if (isHttps) {
  await check("Redirección de http a https", async () => {
    const res = await fetch(`http://${base.host}/`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = res.headers.get("location") ?? "";
    ensure([301, 302, 307, 308].includes(res.status) && location.startsWith("https://"), `Respondió ${res.status} ${location}`);
  });

  await check("Certificado HTTPS", async () => {
    const expires = await certificateExpiry(base.hostname, Number(base.port || 443));
    const days = Math.floor((expires.getTime() - Date.now()) / 86_400_000);
    // Los certificados locales de Caddy (localhost) duran horas a propósito; los de Let's Encrypt, 90 días.
    if (base.hostname !== "localhost") {
      ensure(days >= 14, `Vence en ${days} días (${expires.toISOString().slice(0, 10)}): revisa la renovación de Caddy`);
    }
    return `vence el ${expires.toISOString().slice(0, 10)} (en ${days} días)`;
  });
}

await check("Páginas públicas", async () => {
  for (const path of ["/login", "/registro", "/recuperar", "/privacidad"]) {
    const res = await get(path);
    ensure(res.status === 200, `${path} respondió ${res.status}`);
  }
  return "/login, /registro, /recuperar y /privacidad";
});

await check("Panel protegido", async () => {
  const res = await get("/panel/pedidos");
  ensure(res.status === 302 && res.headers.get("location")?.startsWith("/login"), `Sin sesión respondió ${res.status}`);
  const me = await get("/api/v1/auth/me");
  ensure(me.status === 401, `/api/v1/auth/me sin sesión respondió ${me.status}`);
  const admin = await get("/api/v1/admin/metrics");
  ensure(admin.status === 401, `/api/v1/admin/metrics sin sesión respondió ${admin.status}`);
  return "panel, API y panel central exigen sesión";
});

await check("Métricas protegidas", async () => {
  const res = await get("/metrics");
  ensure(res.status === 401 || res.status === 404, `/metrics sin token respondió ${res.status}`);
  return res.status === 404 ? "desactivadas (sin METRICS_TOKEN)" : "exigen token";
});

await check("Tienda inexistente", async () => {
  const res = await get("/tienda/verificacion-que-no-existe");
  ensure(res.status === 404, `Respondió ${res.status}`);
});

await check("robots.txt", async () => {
  const res = await get("/robots.txt");
  const text = await res.text();
  ensure(res.status === 200, `Respondió ${res.status}`);
  if (environment === "staging") {
    ensure(/^Disallow: \/$/m.test(text), "El entorno de pruebas debe bloquear a los buscadores (Disallow: /)");
    ensure((landingHeaders as Headers | null)?.get("x-robots-tag")?.includes("noindex"), "Falta X-Robots-Tag: noindex en pruebas");
    return "entorno de pruebas: no se indexa";
  }
  ensure(text.includes("Disallow: /panel") && !/^Disallow: \/$/m.test(text), "robots.txt no corresponde a producción");
  return "tiendas indexables; panel y API no";
});

await check("Tiempo real (polling)", async () => {
  const res = await get("/socket.io/?EIO=4&transport=polling");
  const text = await res.text();
  ensure(res.status === 200 && text.startsWith("0{") && text.includes('"sid"'), `Respondió ${res.status}: ${text.slice(0, 80)}`);
});

await check("Tiempo real (WebSocket)", async () => {
  const url = new URL("/socket.io/?EIO=4&transport=websocket", base);
  url.protocol = isHttps ? "wss:" : "ws:";
  // Abre la conexión e intenta entrar sin sesión: debe conectar y luego rechazar la entrada.
  const [open, reply] = await webSocketExchange(url.toString(), "40");
  ensure(open?.startsWith("0{"), `Saludo inesperado: ${open?.slice(0, 80)}`);
  ensure(reply?.startsWith("44") && reply.includes("UNAUTHORIZED"), `Sin sesión debería rechazar la entrada: ${reply?.slice(0, 80)}`);
  return "conecta a través del proxy y exige sesión";
});

const width = Math.max(...outcomes.map((outcome) => outcome.name.length));
console.log(`\nVerificación de ${base.origin}\n`);
for (const outcome of outcomes) {
  const mark = outcome.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${mark} ${outcome.name.padEnd(width)}  ${outcome.detail}`);
}
const failed = outcomes.filter((outcome) => !outcome.ok).length;
console.log(failed ? `\n${failed} de ${outcomes.length} verificaciones fallaron.\n` : `\nTodo en orden (${outcomes.length} verificaciones).\n`);
process.exit(failed ? 1 : 0);
