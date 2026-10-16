import type { DeliveryType } from "../generated/prisma/enums.js";
import { multiplyCOP } from "../utils/currency.js";

/**
 * Cálculo del pedido (secciones 4 y 8 del documento): siempre con los precios actuales
 * de la base de datos, nunca con valores enviados por el navegador.
 *
 * - Subtotal = suma de precio unitario × cantidad.
 * - Domicilio: solo cuando la entrega es a domicilio.
 * - Descuento: 0 en esta versión; la estructura queda lista para promociones.
 * - Total = subtotal + domicilio − descuento (la base de datos lo verifica con un CHECK).
 *
 * Todo en pesos enteros (COP), sin redondeos intermedios.
 */
export interface PricedProduct {
  id: string;
  name: string;
  price: number;
}

export interface PricedLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface OrderTotals {
  lines: PricedLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

export function calculateOrder(input: {
  items: { product: PricedProduct; quantity: number }[];
  deliveryType: DeliveryType;
  deliveryFee: number;
  discount?: number;
}): OrderTotals {
  const lines = input.items.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    unitPrice: product.price,
    quantity,
    subtotal: multiplyCOP(product.price, quantity),
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const deliveryFee = input.deliveryType === "DELIVERY" ? input.deliveryFee : 0;
  // El descuento nunca deja el total por debajo de cero.
  const discount = Math.min(Math.max(0, input.discount ?? 0), subtotal + deliveryFee);
  const total = subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(total)) throw new RangeError("El valor del pedido excede el límite permitido.");
  return { lines, subtotal, deliveryFee, discount, total };
}
