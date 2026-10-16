import { notifications } from "./notification.service.js";

/**
 * Métricas de la aplicación en formato Prometheus (fase 5: monitoreo), sin dependencias.
 * Se exponen en /metrics con METRICS_TOKEN. Las rutas se agrupan por su patrón
 * (/api/v1/orders/:id) para no crear una serie por cada id.
 */
const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const requestCounts = new Map<string, number>();
const durations = new Map<string, { sum: number; count: number; buckets: number[] }>();
let ordersCreated = 0;
let socketConnections = 0;

notifications.onOrderCreated(() => {
  ordersCreated++;
});

const labelValue = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
const labels = (pairs: Record<string, string | number>) =>
  `{${Object.entries(pairs)
    .map(([key, value]) => `${key}="${labelValue(String(value))}"`)
    .join(",")}}`;

export const metrics = {
  observeRequest(method: string, route: string, status: number, ms: number) {
    const countKey = JSON.stringify([method, route, status]);
    requestCounts.set(countKey, (requestCounts.get(countKey) ?? 0) + 1);
    const durationKey = JSON.stringify([method, route]);
    const entry = durations.get(durationKey) ?? { sum: 0, count: 0, buckets: BUCKETS.map(() => 0) };
    entry.sum += ms;
    entry.count++;
    BUCKETS.forEach((bucket, index) => {
      if (ms <= bucket) entry.buckets[index]!++;
    });
    durations.set(durationKey, entry);
  },

  socketConnected() {
    socketConnections++;
  },

  socketDisconnected() {
    socketConnections = Math.max(0, socketConnections - 1);
  },

  render(): string {
    const lines: string[] = [];
    lines.push("# HELP pedifyai_http_requests_total Peticiones HTTP atendidas.", "# TYPE pedifyai_http_requests_total counter");
    for (const [key, count] of requestCounts) {
      const [method, route, status] = JSON.parse(key) as [string, string, number];
      lines.push(`pedifyai_http_requests_total${labels({ method, route, status })} ${count}`);
    }
    lines.push(
      "# HELP pedifyai_http_request_duration_ms Duración de las peticiones HTTP en milisegundos.",
      "# TYPE pedifyai_http_request_duration_ms histogram",
    );
    for (const [key, entry] of durations) {
      const [method, route] = JSON.parse(key) as [string, string];
      BUCKETS.forEach((bucket, index) => {
        lines.push(`pedifyai_http_request_duration_ms_bucket${labels({ method, route, le: bucket })} ${entry.buckets[index]}`);
      });
      lines.push(`pedifyai_http_request_duration_ms_bucket${labels({ method, route, le: "+Inf" })} ${entry.count}`);
      lines.push(`pedifyai_http_request_duration_ms_sum${labels({ method, route })} ${Math.round(entry.sum)}`);
      lines.push(`pedifyai_http_request_duration_ms_count${labels({ method, route })} ${entry.count}`);
    }
    const memory = process.memoryUsage();
    lines.push(
      "# HELP pedifyai_orders_created_total Pedidos creados desde las tiendas desde que arrancó el proceso.",
      "# TYPE pedifyai_orders_created_total counter",
      `pedifyai_orders_created_total ${ordersCreated}`,
      "# HELP pedifyai_socket_connections Paneles conectados en vivo.",
      "# TYPE pedifyai_socket_connections gauge",
      `pedifyai_socket_connections ${socketConnections}`,
      "# HELP process_resident_memory_bytes Memoria residente del proceso.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${memory.rss}`,
      "# HELP process_uptime_seconds Segundos desde que arrancó el proceso.",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${Math.round(process.uptime())}`,
    );
    return `${lines.join("\n")}\n`;
  },
};
