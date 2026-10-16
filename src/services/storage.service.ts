import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Almacenamiento de imágenes (fotos de productos, logos y portadas).
 *
 * - `local`: archivos en UPLOADS_DIR servidos por Express en /uploads.
 * - `s3`: cualquier servicio compatible con S3 (AWS, Cloudflare R2, DigitalOcean Spaces, MinIO).
 *
 * Toda imagen se vuelve a codificar en el servidor antes de guardarse: se corrige la
 * orientación, se reduce el tamaño, se convierte a WebP y se eliminan los metadatos
 * (incluida la ubicación GPS que guardan las fotos del celular).
 */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

/** Las imágenes nunca cambian de contenido (cada versión tiene una clave nueva). */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export class LocalStorage implements StorageDriver {
  readonly root: string;
  readonly baseUrl: string;

  constructor(root: string, baseUrl = "/uploads") {
    this.root = path.resolve(root);
    this.baseUrl = baseUrl;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /** Las claves las genera el servidor; aun así se impide salir de la carpeta. */
  private resolve(key: string): string {
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Clave de almacenamiento inválida: ${key}`);
    return file;
  }
}

export class S3Storage implements StorageDriver {
  readonly client: Pick<S3Client, "send">;
  readonly bucket: string;
  readonly publicBase: string;

  constructor(client: Pick<S3Client, "send">, bucket: string, publicBase: string) {
    this.client = client;
    this.bucket = bucket;
    this.publicBase = publicBase.replace(/\/+$/, "");
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: IMMUTABLE_CACHE }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}

function createStorage(): StorageDriver {
  if (env.STORAGE_DRIVER === "s3") {
    const client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
    return new S3Storage(client, env.S3_BUCKET!, env.S3_PUBLIC_URL!);
  }
  return new LocalStorage(env.UPLOADS_DIR);
}

export const storage: StorageDriver = createStorage();

/** Origen público de las imágenes cuando no se sirven desde la propia app (para la CSP). */
export const imageOrigin: string | null = env.STORAGE_DRIVER === "s3" ? new URL(env.S3_PUBLIC_URL!).origin : null;

// ───────────────────────────── Procesamiento ─────────────────────────────

/** Tamaño máximo del archivo que sube el navegador. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ImagePreset = { width: number; height: number; fit: "inside" | "cover"; quality: number };

/**
 * - product: tarjetas y detalle en la tienda (se recortan con CSS).
 * - logo: cuadrado, se recorta al centro.
 * - banner: portada ancha de la tienda.
 */
export const IMAGE_PRESETS = {
  product: { width: 800, height: 800, fit: "inside", quality: 80 },
  logo: { width: 512, height: 512, fit: "cover", quality: 85 },
  banner: { width: 1600, height: 1000, fit: "inside", quality: 80 },
} satisfies Record<string, ImagePreset>;

export type ImageKind = keyof typeof IMAGE_PRESETS;

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif"]);

const unsupportedImage = () =>
  new AppError(415, "UNSUPPORTED_IMAGE", "Ese archivo no es una imagen válida. Sube una foto JPG, PNG o WebP.");

/** Decodifica, corrige orientación, reduce y convierte a WebP sin metadatos. */
export async function processImage(input: Buffer, kind: ImageKind): Promise<Buffer> {
  const preset: ImagePreset = IMAGE_PRESETS[kind];
  try {
    const image = sharp(input, { limitInputPixels: 50_000_000, failOn: "error" });
    const { format } = await image.metadata();
    if (!format || !ACCEPTED_FORMATS.has(format)) throw unsupportedImage();

    return await image
      .rotate()
      .resize({ width: preset.width, height: preset.height, fit: preset.fit, withoutEnlargement: true })
      .webp({ quality: preset.quality, effort: 4 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw unsupportedImage();
  }
}

/**
 * Procesa y guarda una imagen bajo `folder` con un nombre aleatorio (nunca proviene del usuario).
 * Devuelve la clave (para borrarla después) y la URL pública.
 */
export async function saveImage(input: Buffer, kind: ImageKind, folder: string): Promise<{ key: string; url: string }> {
  const data = await processImage(input, kind);
  const key = `${folder}/${randomBytes(12).toString("base64url")}.webp`;
  await storage.put(key, data, "image/webp");
  return { key, url: storage.publicUrl(key) };
}

/** Borra una imagen sin interrumpir la operación si falla (queda registrado). */
export async function deleteImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await storage.delete(key);
  } catch (err) {
    logger.warn({ err, key }, "No se pudo borrar la imagen del almacenamiento");
  }
}
