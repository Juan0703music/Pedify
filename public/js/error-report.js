// Reporta al servidor los errores de JavaScript del navegador (solo el mensaje, el archivo y la ruta de la
// página; nunca datos del formulario): así se corrigen fallas que solo pasan en ciertos celulares.
// Es un script clásico (no módulo) que se carga antes que los módulos, para capturar también sus
// errores de sintaxis en navegadores antiguos. Escrito sin sintaxis moderna a propósito.
(function () {
  var sent = 0;
  var seen = {};

  function report(message, source, line, column, stack) {
    var key = message + "|" + source + "|" + line;
    if (sent >= 5 || seen[key]) return;
    seen[key] = true;
    sent += 1;
    var body = JSON.stringify({
      message: String(message || "Error desconocido").slice(0, 500),
      source: String(source || "").slice(0, 300),
      line: Number(line) || 0,
      column: Number(column) || 0,
      stack: String(stack || "").slice(0, 3000),
      page: location.pathname.slice(0, 300),
    });
    try {
      fetch("/api/v1/client-errors", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: body });
    } catch (error) {
      // Sin fetch: no se reporta.
    }
  }

  window.addEventListener("error", function (event) {
    // Las fallas al cargar imágenes o scripts no traen mensaje: no son errores de código.
    if (!event.message) return;
    report(event.message, event.filename, event.lineno, event.colno, event.error && event.error.stack);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason || {};
    report(reason.message || String(event.reason), "", 0, 0, reason.stack);
  });
})();
