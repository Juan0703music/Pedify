import request from "supertest";
import { createApp } from "../../src/app.js";

export const app = createApp();

/** Cliente HTTP que conserva las cookies entre peticiones (como un navegador). */
export const newAgent = () => request.agent(app);

let counter = 0;
export const uniqueEmail = (prefix = "comerciante") => `${prefix}${++counter}@ejemplo.com`;

export const PASSWORD = "clave-segura-123";

export interface MerchantInput {
  name: string;
  email: string;
  password: string;
  businessName: string;
  businessPhone: string;
}

/** Registra un comerciante con su negocio y devuelve el agente con la sesión iniciada. */
export async function registerMerchant(overrides: Partial<MerchantInput> = {}) {
  const input: MerchantInput = {
    name: "Ana Pérez",
    email: uniqueEmail(),
    password: PASSWORD,
    businessName: "Sabores del Caribe",
    businessPhone: "300 123 4567",
    ...overrides,
  };
  const agent = newAgent();
  const res = await agent.post("/api/v1/auth/register").send({ ...input, acceptPrivacy: true, acceptTerms: true, idType: "CC", idNumber: "1102345678" });
  if (res.status !== 201) throw new Error(`Registro falló (${res.status}): ${JSON.stringify(res.body)}`);
  const profile = res.body.data as {
    user: { id: string; name: string; email: string };
    businesses: { id: string; name: string; slug: string; role: string }[];
    activeBusinessId: string;
  };
  return { agent, input, profile, businessId: profile.activeBusinessId };
}

export async function login(email: string, password = PASSWORD) {
  const agent = newAgent();
  const res = await agent.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`Login falló (${res.status}): ${JSON.stringify(res.body)}`);
  return agent;
}

/** Extrae el valor de la cookie de sesión de una respuesta. */
export function sessionCookieFrom(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const raw = cookies.find((cookie) => cookie.startsWith("pedify_sid="));
  return raw?.split(";")[0]?.split("=")[1];
}
