import { describe, expect, it } from "vitest";
import { evaluateProof, parseReceipt, type EvaluateInput } from "../src/modules/payment-accounts/proof-check.js";

/** Subido el 23 de octubre de 2026 a las 5:35 p. m. (hora de Colombia). */
const UPLOADED = new Date("2026-10-23T17:35:00-05:00");
const ACCOUNTS = [
  { label: "Nequi", accountKey: "300 123 4567", holderName: "Juan Pérez Gómez" },
  { label: "Bre-B", accountKey: "@sabores2024", holderName: "Sabores del Caribe" },
];

const NEQUI = `¡Listo! Envío exitoso
¿Cuánto?
$ 36.000,00
Para
JUAN PEREZ GOMEZ
Número Nequi
300 123 4567
Fecha
23 de octubre de 2026 a las 05:32 p. m.
Referencia
M10234567
¿De dónde salió la plata?
Disponible`;

const BANCOLOMBIA = `Transferencia exitosa
Comprobante No. 0012345678
23 oct. 2026 - 05:20 p. m.
Valor de la transferencia
$ 45.500,00
Producto destino
Cuenta de Ahorros
*****4567
Producto origen
Ahorros ****9876`;

const check = (input: Partial<EvaluateInput> & { text: string | null }) =>
  evaluateProof({ total: 36_000, accounts: ACCOUNTS, uploadedAt: UPLOADED, reusedImageIn: null, reusedReferenceIn: null, ...input });

const detail = (result: ReturnType<typeof evaluateProof>, key: string) => result.checks.find((item) => item.key === key);

describe("Lectura del comprobante", () => {
  it("encuentra el valor, la referencia, la fecha con la hora y los celulares", () => {
    const parsed = parseReceipt(NEQUI, UPLOADED);
    expect(parsed.amounts).toEqual([36_000]);
    expect(parsed.references).toEqual(["M10234567"]);
    expect(parsed.paidAt).toEqual({ date: new Date("2026-10-23T17:32:00-05:00"), hasTime: true });
    expect(parsed.phones).toEqual(["3001234567"]);
    expect(parsed.success).toBe("exitoso");

    const bank = parseReceipt(BANCOLOMBIA, UPLOADED);
    expect(bank.amounts).toEqual([45_500]);
    expect(bank.references).toEqual(["0012345678"]);
    expect(bank.paidAt?.date).toEqual(new Date("2026-10-23T17:20:00-05:00"));
    expect(bank.maskedEndings).toEqual(["4567", "9876"]);
    // El OCR a veces lee la $ como S, y hay comprobantes sin puntos de mil.
    expect(parseReceipt("Valor S 18.500\nTotal $18500", UPLOADED).amounts).toEqual([18_500]);
  });
});

describe("Verificación del comprobante contra el pedido", () => {
  it("un comprobante de Nequi correcto queda verificado", () => {
    const result = check({ text: NEQUI });
    expect(result.status).toBe("VERIFIED");
    expect(result.checks.map((item) => [item.key, item.ok])).toEqual([
      ["receipt", true],
      ["amount", true],
      ["recipient", true],
      ["date", true],
      ["unique", true],
    ]);
    expect(detail(result, "recipient")?.detail).toBe("Va a tu Nequi 300•••4567.");
    expect(detail(result, "date")?.detail).toBe("Hoy a las 5:32 p. m.");
    expect(detail(result, "unique")?.detail).toBe("Referencia M10234567, no usada en otro pedido.");
  });

  it("acepta la cuenta destino oculta (•••4567), la llave Bre-B o el nombre del titular", () => {
    expect(check({ text: BANCOLOMBIA, total: 45_500 }).status).toBe("VERIFIED");
    const breB = check({ text: "Transferencia exitosa\nValor $ 36.000\nLlave @sabores2024\n23/10/2026 17:30" });
    expect(detail(breB, "recipient")).toMatchObject({ ok: true, detail: "Va a tu llave @sabores2024." });
    const byName = check({ text: "Pago exitoso\n$ 36.000\nPara Juan Perez\n23/10/2026 5:31 PM" });
    expect(detail(byName, "recipient")).toMatchObject({ ok: true, detail: "A nombre de Juan Pérez Gómez." });
  });

  it("no coincide: otro valor, otra cuenta, otro día, pago rechazado o comprobante repetido", () => {
    const amount = check({ text: NEQUI.replace("$ 36.000,00", "$ 30.000,00") });
    expect(amount.status).toBe("MISMATCH");
    expect(detail(amount, "amount")?.detail).toBe("Dice $30.000 y el pedido es de $36.000.");

    const other = check({ text: NEQUI.replace("JUAN PEREZ GOMEZ", "CARLOS RUIZ").replace("300 123 4567", "310 555 7788") });
    expect(detail(other, "recipient")).toMatchObject({ ok: false, detail: "El pago fue a 310•••7788, que no es una de tus cuentas." });

    const old = check({ text: NEQUI.replace("23 de octubre", "20 de octubre") });
    expect(detail(old, "date")).toMatchObject({ ok: false, detail: "Es del 20 de octubre: no es de este pedido." });
    const morning = check({ text: NEQUI.replace("05:32 p. m.", "09:10 a. m.") });
    expect(detail(morning, "date")).toMatchObject({ ok: false, detail: "Es de hace 8 horas (9:10 a. m.): no parece de este pedido." });

    const rejected = check({ text: NEQUI.replace("¡Listo! Envío exitoso", "Transacción rechazada") });
    expect(detail(rejected, "receipt")).toMatchObject({ ok: false, detail: "Dice «rechazada»: el pago no quedó hecho." });

    expect(detail(check({ text: NEQUI, reusedImageIn: 58 }), "unique")?.detail).toBe("Es el mismo pantallazo del pedido #58.");
    const reused = check({ text: NEQUI, reusedReferenceIn: { reference: "M10234567", orderNumber: 41 } });
    expect(reused.status).toBe("MISMATCH");
    expect(detail(reused, "unique")?.detail).toBe("La referencia M10234567 ya se usó en el pedido #41.");
  });

  it("si falta algún dato, queda para revisar; una imagen sin texto no es un comprobante", () => {
    const partial = check({ text: "Envío exitoso\n$ 36.000\nGracias por usar tu app" });
    expect(partial.status).toBe("REVIEW");
    expect(detail(partial, "recipient")?.ok).toBeNull();
    expect(detail(partial, "date")?.ok).toBeNull();

    expect(check({ text: null }).status).toBe("REVIEW");
    const photo = check({ text: "    " });
    expect(photo.status).toBe("MISMATCH");
    expect(detail(photo, "receipt")?.detail).toBe("La imagen no tiene el texto de un comprobante de pago.");
  });
});
