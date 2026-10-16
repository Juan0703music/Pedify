import { existsSync } from "node:fs";
import { z } from "zod";

// En pruebas las variables las define tests/helpers/setup-env.ts.
if (!process.env.VITEST && existsSync(".env")) process.loadEnvFile(".env");

const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true");

/** Una variable vacía en .env (`S3_ENDPOINT=`) cuenta como no definida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.url().default("http://localhost:3000"),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria."),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    COOKIE_SECURE: booleanFromString.default(false),

    // Fotos de productos, logos y portadas.
    // local: carpeta en disco servida en /uploads (desarrollo o un solo servidor con volumen).
    // s3: cualquier almacenamiento compatible con S3 (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO).
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    UPLOADS_DIR: z.string().min(1).default("uploads"),
    S3_BUCKET: optional(z.string()),
    S3_REGION: z.string().default("us-east-1"),
    S3_ENDPOINT: optional(z.url()),
    S3_ACCESS_KEY_ID: optional(z.string()),
    S3_SECRET_ACCESS_KEY: optional(z.string()),
    // URL pública desde la que se sirven los archivos (bucket público o CDN), sin "/" final.
    S3_PUBLIC_URL: optional(z.url().transform((url) => url.replace(/\/+$/, ""))),
    S3_FORCE_PATH_STYLE: booleanFromString.default(false),

    // Correo (recuperación de contraseña). Sin SMTP_URL, en desarrollo el enlace se muestra en el registro.
    SMTP_URL: optional(z.string()),
    MAIL_FROM: z.string().default("PedifyAI <no-responder@pedifyai.com>"),

    // WhatsApp del equipo de PedifyAI para pagos y soporte (formato 57XXXXXXXXXX).
    SUPPORT_WHATSAPP: optional(z.string().regex(/^57\d{10}$/, "Usa el formato 57XXXXXXXXXX.")),

    // Métricas en formato Prometheus en /metrics (desactivadas si no hay token).
    METRICS_TOKEN: optional(z.string().min(16, "METRICS_TOKEN debe tener al menos 16 caracteres.")),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER !== "s3") return;
    for (const key of ["S3_BUCKET", "S3_PUBLIC_URL"] as const) {
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} es obligatoria con STORAGE_DRIVER=s3.` });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variables de entorno inválidas:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
