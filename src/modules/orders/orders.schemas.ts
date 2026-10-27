import { z } from "zod";
import { DeliveryType, OrderStatus, PaymentMethod } from "../../generated/prisma/enums.js";
import { paginationQuerySchema } from "../../utils/pagination.js";
import { mobilePhoneSchema } from "../../utils/phone.js";
import { personNameSchema } from "../auth/auth.schemas.js";
import { optionalText } from "../businesses/businesses.schemas.js";

/** Coordenadas GPS (grados decimales). */
export const geoPointSchema = z.object({
  lat: z.number({ error: "Ubicación inválida." }).min(-90).max(90),
  lng: z.number({ error: "Ubicación inválida." }).min(-180).max(180),
});

/** Clave que genera el navegador por cada intento de compra: un reintento no duplica el pedido. */
export const idempotencyKeySchema = z
  .string({ error: "Falta la clave del pedido." })
  .trim()
  .min(16)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/, "Clave de pedido inválida.");

/**
 * Pedido desde la tienda pública. Solo se reciben productos y cantidades: precios, subtotal,
 * domicilio y total los calcula el servidor (cualquier valor monetario enviado se descarta).
 */
export const createOrderSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    items: z
      .array(
        z.object({
          productId: z.uuid("Producto inválido."),
          quantity: z
            .number({ error: "Cantidad inválida." })
            .int("Cantidad inválida.")
            .min(1, "La cantidad mínima es 1.")
            .max(99, "Puedes pedir hasta 99 unidades de un producto."),
        }),
      )
      .min(1, "Tu pedido está vacío. Agrega al menos un producto.")
      .max(50, "Tu pedido tiene demasiados productos distintos."),
    name: personNameSchema,
    phone: mobilePhoneSchema,
    deliveryType: z.enum(DeliveryType, { error: "Elige cómo recibes tu pedido." }),
    /** Mesa del cliente que come en el local (del QR de la mesa o escrita por él). */
    tableNumber: z.string().trim().max(20, "La mesa no puede superar 20 caracteres.").optional(),
    address: optionalText(160, "La dirección"),
    references: optionalText(160, "Las referencias"),
    paymentMethod: z.enum(PaymentMethod, { error: "Elige cómo vas a pagar." }),
    notes: optionalText(300, "Las notas"),
    /** Punto exacto que el cliente marcó con su GPS (opcional; solo se guarda en domicilios). */
    location: geoPointSchema.optional(),
    /** Comprobante que subió el cliente (obligatorio si el negocio cobra ese método por adelantado). */
    paymentProofId: z.uuid("Vuelve a subir el comprobante.").optional(),
  })
  .refine((order) => order.deliveryType !== "DELIVERY" || Boolean(order.address), {
    path: ["address"],
    message: "Escribe la dirección de entrega.",
    // Se revisa aunque otros campos tengan errores, para mostrarlos todos de una vez.
    when: (payload) => (payload.value as { deliveryType?: unknown })?.deliveryType === "DELIVERY",
  });

export const storeOrderParamsSchema = z.object({
  slug: z.string().trim().toLowerCase().max(60),
});

export const storeOrderIdParamsSchema = storeOrderParamsSchema.extend({
  id: z.uuid("Pedido inválido."),
});
export const whatsappOpenedParamsSchema = storeOrderIdParamsSchema;

export const whatsappOpenedSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
});


// ─── Panel del comerciante ───

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.");

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  /** active: pedidos en curso · history: entregados y cancelados (paginado). */
  view: z.enum(["active", "history"]).default("active"),
  search: z.string().trim().max(80).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const orderParamsSchema = z.object({
  id: z.uuid("Pedido inválido."),
});

export const changeStatusSchema = z.object({
  status: z.enum(OrderStatus, { error: "Estado inválido." }),
  /** Estado que el panel tenía en pantalla: si cambió entre tanto, se avisa en lugar de sobrescribir. */
  from: z.enum(OrderStatus).optional(),
  reason: optionalText(200, "El motivo"),
});

export const paymentSchema = z.object({
  paid: z.boolean({ error: "Indica si el pedido está pagado." }),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type OrderParams = z.infer<typeof orderParamsSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type StoreOrderParams = z.infer<typeof storeOrderParamsSchema>;
export type WhatsappOpenedParams = z.infer<typeof whatsappOpenedParamsSchema>;
export type StoreOrderIdParams = z.infer<typeof storeOrderIdParamsSchema>;

