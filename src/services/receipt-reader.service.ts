import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { logger } from "../utils/logger.js";

/**
 * Lectura de los comprobantes de pago (OCR con Tesseract en español), dentro del propio servidor: sin
 * servicios externos ni costos por comprobante. Hay un solo lector para toda la aplicación y los
 * comprobantes esperan su turno (cada uno tarda uno o dos segundos).
 */
const require = createRequire(import.meta.url);
const LANG_PATH = path.join(path.dirname(require.resolve("@tesseract.js-data/spa/package.json")), "4.0.0_best_int");
const READ_TIMEOUT_MS = 30_000;

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("spa", OEM.LSTM_ONLY, { langPath: LANG_PATH, gzip: true, cacheMethod: "none" }).catch((error: unknown) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

async function resetWorker() {
  const current = workerPromise;
  workerPromise = null;
  await (await current?.catch(() => null))?.terminate().catch(() => {});
}

/** Pantallazo listo para leer: derecho, en gris, con contraste y un ancho cómodo. */
const prepare = (image: Buffer) =>
  sharp(image).rotate().resize({ width: 1200, withoutEnlargement: false }).grayscale().normalize().png().toBuffer();

async function recognize(image: Buffer): Promise<string> {
  const [worker, input] = await Promise.all([getWorker(), prepare(image)]);
  let timer: NodeJS.Timeout | undefined;
  try {
    const { data } = await Promise.race([
      worker.recognize(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("La lectura del comprobante tardó demasiado")), READ_TIMEOUT_MS);
      }),
    ]);
    return data.text;
  } catch (error) {
    // Un lector trabado no sirve para el siguiente comprobante: se crea otro.
    await resetWorker();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Huella exacta del archivo: el mismo pantallazo subido otra vez da la misma huella. (Un parecido visual
 * no sirve: todos los comprobantes de una billetera se ven casi iguales; para un pantallazo nuevo del
 * mismo pago se compara la referencia leída.)
 */
export const imageFingerprint = (image: Buffer) => createHash("sha256").update(image).digest("hex");

export const receiptReader = {
  /** Texto del comprobante. Lanza un error si no se pudo leer. */
  read(image: Buffer): Promise<string> {
    const job = queue.then(() => recognize(image));
    queue = job.catch(() => {});
    return job;
  },

  /** Cierra el lector (al apagar el servidor). */
  async close() {
    await resetWorker();
    logger.debug("Lector de comprobantes cerrado");
  },
};
