import sharp from "sharp";

/** Código del QR de cobro de Nequi de la cuenta «ANA PEREZ» que usan las pruebas. */
export const NEQUI_PAYLOAD = "00020101021126280012CO.COM.NEQUI0110300123456752045812530317058 02CO5910ANA PEREZ6009SINCELEJO6304C3D4";

const bogota = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", ...options }).format(new Date());

/** Pantallazo de un comprobante de Nequi hecho ahora mismo, como el que sube el cliente. */
export function nequiReceipt(amount: string, { to = "ANA PEREZ", phone = "300 123 4567", reference = "M10234567" } = {}) {
  const date = `${bogota({ day: "numeric", month: "long", year: "numeric" })} a las ${bogota({ hour: "2-digit", minute: "2-digit" })}`;
  const line = (y: number, text: string, size = 46, color = "#200020", weight = "normal") =>
    `<text x="80" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1700">
    <rect width="1080" height="1700" fill="#ffffff"/><rect width="1080" height="380" fill="#200020"/>
    <text x="540" y="230" font-family="DejaVu Sans, sans-serif" font-size="62" font-weight="bold" fill="#ffffff" text-anchor="middle">¡Listo! Envío exitoso</text>
    ${line(520, "¿Cuánto?", 40, "#6b6b6b")}${line(600, amount, 70, "#200020", "bold")}
    ${line(730, "Para", 40, "#6b6b6b")}${line(790, to)}
    ${line(910, "Número Nequi", 40, "#6b6b6b")}${line(970, phone)}
    ${line(1090, "Fecha", 40, "#6b6b6b")}${line(1150, date)}
    ${line(1270, "Referencia", 40, "#6b6b6b")}${line(1330, reference)}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}
