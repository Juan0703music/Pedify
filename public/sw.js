// Service worker de Pedify: recibe los avisos push de pedidos nuevos, abre el panel al tocarlos y, si no
// hay internet, muestra una pantalla propia en vez del error del navegador (también en la app instalada).
// No guarda el panel en caché: siempre se carga del servidor (los pedidos deben estar al día).

const OFFLINE_CACHE = "pedify-offline-v1";
const OFFLINE_URL = "/offline.html";
// La pantalla sin conexión usa la letra de Pedify: se guarda junto con ella.
const FONT_URL = "/assets/fonts/archivo-latin-wdth.woff2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, FONT_URL].map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("pedify-") && name !== OFFLINE_CACHE).map((name) => caches.delete(name)));
      // Por si una versión anterior dejó activada la precarga de páginas (ver «fetch»).
      await self.registration.navigationPreload?.disable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === FONT_URL) {
    event.respondWith(fetch(event.request).catch(() => caches.match(FONT_URL)));
    return;
  }
  if (event.request.mode !== "navigate") return;
  // Sin «navigation preload»: en Firefox, si la precarga falla por falta de red, la navegación termina en
  // el error del navegador antes de llegar a la pantalla sin conexión.
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pedify", {
      body: data.body || "Tienes un pedido nuevo.",
      icon: "/assets/icons/icon-192.png",
      badge: "/assets/icons/badge-96.png",
      tag: data.tag || "pedify",
      renotify: true,
      // En el computador queda a la vista hasta que alguien lo atienda.
      requireInteraction: true,
      vibrate: [220, 120, 220],
      data: { url: data.url || "/panel/pedidos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/panel/pedidos", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Si el panel ya está abierto (el del negocio o el central de Pedify, según el aviso), se usa esa pestaña.
      const section = target.pathname.startsWith("/admin") ? "/admin" : "/panel";
      const panel = windows.find((client) => new URL(client.url).pathname.startsWith(section));
      if (panel) {
        await panel.focus();
        if ("navigate" in panel) return panel.navigate(target.href).catch(() => self.clients.openWindow(target.href));
        return undefined;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
