import { createRequire } from "node:module";
const require = createRequire("/home/ing-juan/Escritorio/Contafi/apps/escritorio/package.json");
const puppeteer = require("puppeteer-core");
const out = "/tmp/claude-1000/-home-ing-juan/991f64ea-c614-4df5-a978-b15d9bda96ee/scratchpad/shots";
const base = "https://used-butter-estate-forms.trycloudflare.com";
const slug = process.argv[2] ?? "el-costeno-salchipapense";
const preset = process.argv[3]; // método de pago guardado (opcional)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "/tmp/claude-1000/-home-ing-juan/991f64ea-c614-4df5-a978-b15d9bda96ee/scratchpad/chrome/chrome-headless-shell/linux-155.0.8059.84/chrome-headless-shell-linux64/chrome-headless-shell",
  headless: "shell",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  page.on("console", (m: any) => console.log("consola:", m.type(), m.text()));
  page.on("pageerror", (e: any) => console.log("error de página:", e.message));
  await page.emulate(puppeteer.KnownDevices["Pixel 7"] ?? puppeteer.KnownDevices["Pixel 5"]);
  await page.goto(`${base}/tienda/${slug}`, { waitUntil: "networkidle0" });
  await page.evaluate(`localStorage.clear(); ${preset ? `localStorage.setItem("pedify:customer", JSON.stringify({ name: "Prueba", phone: "3009990011", address: "Calle 1", references: "", paymentMethod: "${preset}", deliveryType: "DELIVERY", location: null }))` : ""}`);
  await page.reload({ waitUntil: "networkidle0" });
  await wait(800);
  await page.tap("#menu [data-inc]");
  await wait(800);
  await page.screenshot({ path: `${out}/c1-barra.png` });
  await page.tap("[data-open-cart]");
  await wait(1500);
  console.log("hojas:", await page.evaluate(`[...document.querySelectorAll("dialog")].map((d) => d.open + " " + JSON.stringify(d.getBoundingClientRect())).join(" | ")`));
  await page.screenshot({ path: `${out}/c2-tras-tocar.png` });
} finally {
  await browser.close();
}
