// Service worker de Pedify: solo recibe los avisos push de pedidos nuevos y abre el panel al tocarlos.
// No guarda páginas en caché: el panel siempre se carga del servidor (los pedidos deben estar al día).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
      // Si el panel ya está abierto, se usa esa pestaña.
      const panel = windows.find((client) => new URL(client.url).pathname.startsWith("/panel"));
      if (panel) {
        await panel.focus();
        if ("navigate" in panel) return panel.navigate(target.href).catch(() => self.clients.openWindow(target.href));
        return undefined;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
