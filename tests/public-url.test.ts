import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { publicAppUrl } from "../src/config/public-url.js";

const interfaces = vi.hoisted(() => ({ current: {} as Record<string, Partial<NetworkInterfaceInfo>[]> }));
vi.mock("node:os", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:os")>()), networkInterfaces: () => interfaces.current }));

const original = { NODE_ENV: env.NODE_ENV, APP_URL: env.APP_URL, PUBLIC_URL: env.PUBLIC_URL };
afterEach(() => Object.assign(env, original));

const ipv4 = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal });

describe("Dirección para abrir Pedify desde el celular (QR y enlaces)", () => {
  it("en este computador cambia localhost por su IP en el Wi-Fi, no la de Docker", () => {
    Object.assign(env, { NODE_ENV: "development", APP_URL: "http://localhost:3000" });
    interfaces.current = { lo: [ipv4("127.0.0.1", true)], docker0: [ipv4("172.17.0.1")], wlp2s0: [ipv4("192.168.1.50"), { address: "fe80::1", family: "IPv6", internal: false }] };
    expect(publicAppUrl()).toBe("http://192.168.1.50:3000");

    // Sin red: queda localhost (solo sirve en este computador).
    interfaces.current = { lo: [ipv4("127.0.0.1", true)] };
    expect(publicAppUrl()).toBe("http://localhost:3000");
  });

  it("con un túnel (PUBLIC_URL), los QR usan esa dirección, que abre desde cualquier red", () => {
    Object.assign(env, { NODE_ENV: "development", APP_URL: "http://localhost:3000", PUBLIC_URL: "https://mesa-cuatro.trycloudflare.com" });
    interfaces.current = { wlp2s0: [ipv4("192.168.1.50")] };
    expect(publicAppUrl()).toBe("https://mesa-cuatro.trycloudflare.com");
  });

  it("con un dominio, o fuera de desarrollo, es siempre APP_URL", () => {
    interfaces.current = { wlp2s0: [ipv4("192.168.1.50")] };
    Object.assign(env, { NODE_ENV: "production", APP_URL: "http://localhost:3000" });
    expect(publicAppUrl()).toBe("http://localhost:3000");
    Object.assign(env, { NODE_ENV: "development", APP_URL: "https://pedify.co" });
    expect(publicAppUrl()).toBe("https://pedify.co");
  });
});
