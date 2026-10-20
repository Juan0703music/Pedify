import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import express, { Router, type RequestHandler } from "express";
import helmet from "helmet";
import { z } from "zod";
import { corsMiddleware, originGuard } from "./config/cors.js";
import { prisma } from "./config/database.js";
import { env, environmentName, isProduction, isStaging } from "./config/env.js";
import { apiNotFound, errorHandler } from "./middlewares/errorHandler.js";
import { apiLimiter } from "./middlewares/rateLimiter.js";
import { requestContext } from "./middlewares/requestContext.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { readSessionToken } from "./modules/auth/session-cookie.js";
import { businessesRoutes } from "./modules/businesses/businesses.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";
import { customersRoutes } from "./modules/customers/customers.routes.js";
import { ordersRoutes, storeOrderRoutes } from "./modules/orders/orders.routes.js";
import { categoriesRoutes, productsRoutes } from "./modules/products/products.routes.js";
import { storeController } from "./modules/products/store.controller.js";
import { storeRoutes } from "./modules/products/store.routes.js";
import { courierRoutes } from "./modules/courier/courier.routes.js";
import { paymentAccountsRoutes } from "./modules/payment-accounts/payment-accounts.routes.js";
import { pushRoutes } from "./modules/push/push.routes.js";
import { pushService } from "./modules/push/push.service.js";
import { subscriptionRoutes } from "./modules/subscriptions/subscriptions.routes.js";
import { metrics } from "./services/metrics.service.js";
import { imageOrigin } from "./services/storage.service.js";
import { publicDir, sendPage } from "./utils/pages.js";
import { mapConfig, mapTileOrigin } from "./config/map.js";

// Mensajes de validación de Zod en español por defecto.
z.config(z.locales.es());

/** Páginas del frontend con URLs limpias → archivo dentro de public/. */
const PUBLIC_PAGES: Record<string, string> = {
  "/": "index.html",
  "/login": "pages/auth/login.html",
  "/registro": "pages/auth/register.html",
  "/recuperar": "pages/auth/forgot.html",
  "/restablecer": "pages/auth/reset.html",
  "/privacidad": "pages/legal/privacy.html",
  // Página del domiciliario (la clave del pedido va después de "#").
  "/domicilio": "pages/courier/index.html",
};

/** Páginas del panel: requieren cookie de sesión (la API valida la sesión en cada llamada). */
const PANEL_PAGES: Record<string, string> = {
  "/panel": "pages/dashboard/index.html",
  "/panel/pedidos": "pages/dashboard/orders.html",
  "/panel/menu": "pages/dashboard/products.html",
  "/panel/clientes": "pages/dashboard/customers.html",
  "/panel/analiticas": "pages/dashboard/analytics.html",
  "/panel/tienda": "pages/dashboard/store.html",
  "/panel/configuracion": "pages/dashboard/settings.html",
  "/panel/plan": "pages/dashboard/plan.html",
  "/admin": "pages/admin/index.html",
};

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/**
 * robots.txt: el entorno de pruebas no se indexa; en producción solo las tiendas y las páginas públicas.
 */
const ROBOTS = isStaging
  ? "User-agent: *\nDisallow: /\n"
  : ["User-agent: *", "Disallow: /panel", "Disallow: /admin", "Disallow: /api/", "Disallow: /restablecer", ""].join("\n");

/** /metrics (Prometheus): solo con `Authorization: Bearer <METRICS_TOKEN>`; sin token configurado, no existe. */
const metricsEndpoint: RequestHandler = (req, res, next) => {
  if (!env.METRICS_TOKEN) return next();
  const expected = Buffer.from(`Bearer ${env.METRICS_TOKEN}`);
  const received = Buffer.from(req.get("authorization") ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(401).set("WWW-Authenticate", "Bearer").type("text").send("No autorizado");
  }
  res.set("Cache-Control", "no-store").type("text/plain; version=0.0.4").send(metrics.render());
};

function apiRouter(): Router {
  const api = Router();

  // Salud: lo consultan Docker (HEALTHCHECK) y el monitoreo externo. 503 si la base no responde.
  api.get("/health", async (_req, res) => {
    const started = performance.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.set("Cache-Control", "no-store").json({
        data: {
          status: "ok",
          version,
          environment: environmentName,
          uptimeSeconds: Math.round(process.uptime()),
          database: { status: "ok", latencyMs: Math.round(performance.now() - started) },
        },
      });
    } catch {
      res
        .status(503)
        .set("Cache-Control", "no-store")
        .json({ data: { status: "error", version, environment: environmentName, database: { status: "error" } } });
    }
  });

  // Teselas y atribución del mapa (seguimiento de domicilios). Es pública y casi nunca cambia.
  api.get("/map-config", (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600").json({ data: mapConfig });
  });

  api.use("/auth", authRoutes);
  api.use("/businesses/current/payment-accounts", paymentAccountsRoutes);
  api.use("/businesses", businessesRoutes);
  api.use("/products", productsRoutes);
  api.use("/categories", categoriesRoutes);
  api.use("/orders", ordersRoutes);
  api.use("/customers", customersRoutes);
  api.use("/analytics", analyticsRoutes);
  api.use("/subscription", subscriptionRoutes);
  api.use("/push", pushRoutes);
  api.use("/courier", courierRoutes);
  api.use("/admin", adminRoutes);
  api.use("/store/:slug/orders", storeOrderRoutes);
  api.use("/store", storeRoutes);

  return api;
}

export function createApp() {
  const app = express();
  // Avisos push de pedidos nuevos (si hay llaves VAPID).
  pushService.listen();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:", "blob:", mapTileOrigin, ...(imageOrigin ? [imageOrigin] : [])],
          "connect-src": ["'self'"],
          // En local (http) no se fuerza HTTPS.
          "upgrade-insecure-requests": env.COOKIE_SECURE ? [] : null,
        },
      },
      strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 31_536_000 } : false,
    }),
  );
  app.use(requestContext);
  if (isStaging) {
    app.use((_req, res, next) => {
      res.set("X-Robots-Tag", "noindex, nofollow");
      next();
    });
  }
  app.get("/metrics", metricsEndpoint);
  app.get("/robots.txt", (_req, res) => res.type("text").set("Cache-Control", "public, max-age=3600").send(ROBOTS));

  // ─── API ───
  app.use(
    "/api/v1",
    corsMiddleware,
    originGuard,
    apiLimiter,
    express.json({ limit: "100kb" }),
    apiRouter(),
  );
  app.use("/api", apiNotFound);

  // ─── Páginas ───
  for (const [route, file] of Object.entries(PUBLIC_PAGES)) {
    app.get(route, async (_req, res) => {
      res.set("Cache-Control", "no-cache");
      await sendPage(res, file);
    });
  }
  for (const [route, file] of Object.entries(PANEL_PAGES)) {
    app.get(route, async (req, res) => {
      if (!readSessionToken(req.headers.cookie)) {
        return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      }
      res.set("Cache-Control", "no-store");
      await sendPage(res, file);
    });
  }

  // Service worker de los avisos push: en la raíz (alcance de todo el sitio) y sin caché.
  app.get("/sw.js", (_req, res) => {
    res.set("Cache-Control", "no-cache").type("application/javascript");
    res.sendFile(path.join(publicDir, "sw.js"));
  });
  app.get("/manifest.webmanifest", (_req, res) => {
    res.set("Cache-Control", "no-cache").type("application/manifest+json");
    res.sendFile(path.join(publicDir, "manifest.webmanifest"));
  });

  // Tienda pública de cada negocio (las etiquetas para compartir se generan en el servidor).
  app.get("/tienda/:slug", storeController.page);

  // Imágenes subidas con STORAGE_DRIVER=local. Cada versión tiene un nombre nuevo: caché de un año.
  if (env.STORAGE_DRIVER === "local") {
    app.use("/uploads", express.static(path.resolve(env.UPLOADS_DIR), { index: false, immutable: true, maxAge: "365d" }));
    app.use("/uploads", (_req, res) => res.status(404).end());
  }

  app.use(express.static(publicDir, { index: false, maxAge: isProduction ? "1h" : 0 }));

  app.use(async (_req, res) => {
    await sendPage(res, "404.html", 404);
  });

  app.use(errorHandler);

  return app;
}
