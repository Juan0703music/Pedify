import { describe, expect, it } from "vitest";
import { slugify } from "../src/modules/businesses/businesses.service.js";
import { formatCOP, multiplyCOP, percentOfCOP, roundCOP } from "../src/utils/currency.js";
import { formatColombianPhone, normalizeColombianPhone } from "../src/utils/phone.js";

describe("Dinero en COP", () => {
  it("formatea con separador de miles colombiano", () => {
    expect(formatCOP(18000)).toBe("$18.000");
    expect(formatCOP(1250000)).toBe("$1.250.000");
    expect(formatCOP(0)).toBe("$0");
    expect(formatCOP(-4000)).toBe("-$4.000");
  });

  it("redondea al peso más cercano con mitades hacia arriba", () => {
    expect(roundCOP(12.5)).toBe(13);
    expect(roundCOP(12.49)).toBe(12);
    expect(percentOfCOP(41000, 10)).toBe(4100);
    expect(percentOfCOP(15999, 5)).toBe(800); // 799,95 → 800
  });

  it("detecta resultados fuera del rango seguro", () => {
    expect(multiplyCOP(18000, 2)).toBe(36000);
    expect(() => multiplyCOP(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });
});

describe("Teléfonos colombianos", () => {
  it("normaliza distintas formas de escribir el mismo número", () => {
    for (const input of ["300 123 4567", "3001234567", "+57 300-123-4567", "57 3001234567", "0057 300 123 4567"]) {
      expect(normalizeColombianPhone(input)).toBe("573001234567");
    }
    expect(normalizeColombianPhone("604 123 4567")).toBe("576041234567");
  });

  it("rechaza números inválidos", () => {
    for (const input of ["123", "2001234567", "+1 300 123 4567", "30012345678"]) {
      expect(normalizeColombianPhone(input)).toBeNull();
    }
  });

  it("formatea para mostrar", () => {
    expect(formatColombianPhone("573001234567")).toBe("300 123 4567");
  });
});

describe("Slugs públicos", () => {
  it("convierte nombres con tildes, eñes y símbolos", () => {
    expect(slugify("Sabores del Caribe")).toBe("sabores-del-caribe");
    expect(slugify("Salchipapería Doña Peña")).toBe("salchipaperia-dona-pena");
    expect(slugify("Pollo & Papas #1")).toBe("pollo-y-papas-1");
    expect(slugify("  --Café--  ")).toBe("cafe");
  });

  it("garantiza una longitud mínima", () => {
    expect(slugify("A").length).toBeGreaterThanOrEqual(3);
    expect(slugify("!!!")).toMatch(/^negocio-[a-f0-9]+$/);
  });
});
