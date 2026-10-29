import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./helpers/app.js";

const publicFile = (url: string) => `public${url}`;

interface ManifestImage {
  src: string;
  sizes: string;
  type: string;
}

describe("Pedify como app en el celular y en el computador", () => {
  it("el manifiesto permite instalarla y todos sus íconos y capturas existen con su tamaño", async () => {
    const res = await request(app).get("/manifest.webmanifest").expect(200);
    expect(res.headers["content-type"]).toContain("application/manifest+json");
    const manifest = JSON.parse(res.text) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      icons: (ManifestImage & { purpose: string })[];
      shortcuts: { url: string; icons: ManifestImage[] }[];
      screenshots: (ManifestImage & { form_factor: string })[];
    };
    expect(manifest).toMatchObject({ id: "/panel/pedidos", start_url: "/panel/pedidos", scope: "/", display: "standalone" });
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual(expect.arrayContaining(["any", "maskable"]));
    // Capturas para la ventana de instalación: en celular (narrow) y en computador (wide).
    expect(new Set(manifest.screenshots.map((shot) => shot.form_factor))).toEqual(new Set(["narrow", "wide"]));

    const images = [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons), ...manifest.screenshots];
    for (const image of images) {
      const file = publicFile(image.src);
      expect(existsSync(file), image.src).toBe(true);
      const { width, height, format } = await sharp(file).metadata();
      expect(`${width}x${height}`, image.src).toBe(image.sizes);
      expect(`image/${format === "jpeg" ? "jpeg" : format}`, image.src).toBe(image.type);
    }
    for (const shortcut of manifest.shortcuts) expect(shortcut.url).toMatch(/^\/panel/);
  });

  it("la página /app explica cómo instalarla y trae el código QR para el celular", async () => {
    const page = await request(app).get("/app").expect(200);
    expect(page.text).toContain('rel="manifest"');
    expect(page.text).toContain("/js/app-page.js");

    const qr = await request(app).get("/app/qr.svg").expect(200);
    expect(qr.headers["content-type"]).toContain("image/svg+xml");
    expect(Buffer.from(qr.body as Buffer).toString("utf8")).toMatch(/^<svg/);
  });

  it("sin internet muestra una pantalla propia, sin scripts (la política de seguridad no los permite)", async () => {
    const worker = await request(app).get("/sw.js").expect(200);
    expect(worker.headers["cache-control"]).toBe("no-cache");
    expect(worker.text).toContain('"/offline.html"');
    expect(worker.text).toContain('"/assets/fonts/archivo-latin-wdth.woff2"');

    const offline = await request(app).get("/offline.html").expect(200);
    expect(offline.text).toContain("Sin conexión");
    expect(offline.text).not.toMatch(/<script/i);
    expect(offline.headers["content-security-policy"]).toContain("script-src 'self'");
  });

  it("todas las páginas del panel registran la app (manifiesto) y cargan el panel compartido", () => {
    for (const page of ["index", "orders", "products", "customers", "analytics", "store", "settings", "plan"]) {
      const html = readFileSync(`public/pages/dashboard/${page}.html`, "utf8");
      expect(html, page).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    }
    expect(readFileSync("public/js/dashboard.js", "utf8")).toContain('from "./install.js"');
  });

  it("el panel central se instala como otra app, «Pedify Admin», que abre directo en /admin", async () => {
    const res = await request(app).get("/admin.webmanifest").expect(200);
    expect(res.headers["content-type"]).toContain("application/manifest+json");
    const manifest = JSON.parse(res.text);
    expect(manifest).toMatchObject({ id: "/admin", name: "Pedify Admin", start_url: "/admin", scope: "/", display: "standalone" });
    expect(manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url)).toContain("/admin#pagos");
    expect(readFileSync("public/pages/admin/index.html", "utf8")).toContain('<link rel="manifest" href="/admin.webmanifest" />');
    expect(readFileSync("public/js/admin.js", "utf8")).toContain('from "./install.js"');
  });
});
