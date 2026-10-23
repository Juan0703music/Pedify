import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";

/**
 * Wompi, la pasarela de pagos de Bancolombia: cobra los planes con tarjeta, PSE, Nequi o botón
 * Bancolombia y consigna el dinero en la cuenta bancaria registrada en Wompi.
 * - Web Checkout: Pedify arma el enlace firmado (firma de integridad) y el negocio paga en Wompi.
 * - Eventos: Wompi avisa cada cambio de una transacción a /api/v1/webhooks/wompi (firma con el secreto de eventos).
 * - Con llaves de prueba (pub_test_…) todo va al sandbox y no se cobra dinero real.
 * Documentación: https://docs.wompi.co/docs/colombia/
 */
const CHECKOUT_URL = "https://checkout.wompi.co/p/";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const WOMPI_STATUSES = ["PENDING", "APPROVED", "DECLINED", "VOIDED", "ERROR"] as const;

export const transactionSchema = z.object({
  id: z.string().min(1).max(100),
  status: z.string(),
  reference: z.string().max(200),
  amount_in_cents: z.number().int(),
  currency: z.string(),
  payment_method_type: z.string().max(60).nullish(),
});

export type WompiTransaction = z.infer<typeof transactionSchema>;

/** Evento que Wompi envía al webhook (transaction.updated y otros). */
export const wompiEventSchema = z.object({
  event: z.string().max(100),
  data: z.record(z.string(), z.unknown()),
  signature: z.object({
    properties: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/).max(100)).min(1).max(20),
    checksum: z.string().regex(/^[0-9a-fA-F]{64}$/),
  }),
  timestamp: z.number().int(),
});

export type WompiEvent = z.infer<typeof wompiEventSchema>;

/** Nombre del medio de pago para mostrarlo al negocio. */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CARD: "Tarjeta",
  NEQUI: "Nequi",
  PSE: "PSE",
  BANCOLOMBIA_TRANSFER: "Botón Bancolombia",
  BANCOLOMBIA_QR: "QR Bancolombia",
  DAVIPLATA: "Daviplata",
};

export const paymentMethodLabel = (type: string | null | undefined) => (type && PAYMENT_METHOD_LABEL[type]) || "En línea";

export const wompi = {
  /** Las cuatro llaves están configuradas (env.ts no permite que falte alguna). */
  enabled(): boolean {
    return Boolean(env.WOMPI_PUBLIC_KEY && env.WOMPI_PRIVATE_KEY && env.WOMPI_EVENTS_SECRET && env.WOMPI_INTEGRITY_SECRET);
  },

  /** Llaves de prueba: sandbox, sin cobros reales. */
  sandbox(): boolean {
    return env.WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ?? false;
  },

  apiUrl(): string {
    return wompi.sandbox() ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
  },

  /** Firma de integridad: SHA-256 de referencia + valor en centavos + moneda + secreto de integridad. */
  integritySignature(reference: string, amountInCents: number, currency = "COP"): string {
    return sha256(`${reference}${amountInCents}${currency}${env.WOMPI_INTEGRITY_SECRET}`);
  },

  /** Enlace al Web Checkout de Wompi con el valor firmado (no se puede cambiar en el navegador). */
  checkoutUrl(input: { reference: string; amountInCents: number; redirectUrl: string; customer: { email: string; name: string } }): string {
    const params = new URLSearchParams({
      "public-key": env.WOMPI_PUBLIC_KEY!,
      currency: "COP",
      "amount-in-cents": String(input.amountInCents),
      reference: input.reference,
      "signature:integrity": wompi.integritySignature(input.reference, input.amountInCents),
      "redirect-url": input.redirectUrl,
      "customer-data:email": input.customer.email,
      "customer-data:full-name": input.customer.name,
    });
    return `${CHECKOUT_URL}?${params}`;
  },

  /**
   * Verifica que el evento viene de Wompi: SHA-256 de los valores de `signature.properties`
   * (leídos de `data`), el `timestamp` y el secreto de eventos, comparado con `signature.checksum`.
   */
  verifyEvent(event: WompiEvent): boolean {
    if (!env.WOMPI_EVENTS_SECRET) return false;
    const values = event.signature.properties.map((path) => {
      const value = path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), event.data);
      return value === undefined || value === null ? "" : String(value);
    });
    const expected = Buffer.from(sha256(`${values.join("")}${event.timestamp}${env.WOMPI_EVENTS_SECRET}`));
    const received = Buffer.from(event.signature.checksum.toLowerCase());
    return expected.length === received.length && timingSafeEqual(expected, received);
  },

  /** Consulta una transacción con la llave privada (solo desde el servidor). null si Wompi no la conoce. */
  async getTransaction(id: string): Promise<WompiTransaction | null> {
    const res = await fetch(`${wompi.apiUrl()}/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${env.WOMPI_PRIVATE_KEY}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wompi respondió ${res.status} al consultar la transacción`);
    return transactionSchema.parse(((await res.json()) as { data?: unknown }).data);
  },
};
