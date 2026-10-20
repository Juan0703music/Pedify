import { createRequire } from "node:module";
const require = createRequire("/home/ing-juan/Escritorio/Contafi/apps/escritorio/package.json");
const puppeteer = require("puppeteer-core");
const out = "/tmp/claude-1000/-home-ing-juan/991f64ea-c614-4df5-a978-b15d9bda96ee/scratchpad/shots";
const base = "https://used-butter-estate-forms.trycloudflare.com";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ browser: "firefox", executablePath: "/usr/bin/firefox", headless: true, userDataDir: `${process.env.HOME}/snap/firefox/common/pedifyai-capturas`, extraPrefsFirefox: { "dom.w3c_touch_events.enabled": 1 } });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e: any) => console.log("error de página:", e.message));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/tienda/el-costeno-salchipapense`, { waitUntil: "networkidle0" });
  await page.evaluate(`localStorage.clear()`);
  await page.reload({ waitUntil: "networkidle0" });
  await wait(800);
  const plus = await page.evaluate(`(() => { const b = document.querySelector("#menu [data-inc]"); b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await wait(400);
  await page.mouse.click(plus.x, plus.y);
  await wait(800);
  const bar = await page.evaluate(`(() => { const b = document.querySelector("[data-open-cart]"); if (!b) return null; const r = b.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, top: top ? top.outerHTML.slice(0, 160) : null, inside: b.contains(top) }; })()`);
  console.log("barra:", JSON.stringify(bar));
  await page.screenshot({ path: `${out}/t1-barra.png` });
  if (bar) await page.mouse.click(bar.x, bar.y);
  await wait(1200);
  console.log("hojas:", await page.evaluate(`[...document.querySelectorAll("dialog")].map((d) => d.open).join(",")`));
  await page.screenshot({ path: `${out}/t2-tras-tocar.png` });
} finally {
  await browser.close();
}
