import webpush from "web-push";
import { inject } from "vitest";

// Se ejecuta antes de importar la aplicación en cada archivo de pruebas.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = inject("databaseUrl");
process.env.APP_URL = "http://localhost:3000";
process.env.COOKIE_SECURE = "false";
process.env.SESSION_TTL_DAYS = "7";
process.env.STORAGE_DRIVER = "local";
process.env.UPLOADS_DIR = inject("uploadsDir");
process.env.METRICS_TOKEN = "token-de-metricas-de-prueba";
process.env.SUPPORT_WHATSAPP = "573009998877";
// Llaves VAPID de prueba (los envíos reales se reemplazan en las pruebas de avisos push).
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
