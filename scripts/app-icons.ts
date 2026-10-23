/**
 * Íconos de la app instalada, de sus accesos directos y de las notificaciones push (public/assets/icons):
 *   npx tsx scripts/app-icons.ts
 * Se generan desde el logotipo; los archivos se versionan.
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const dir = "public/assets/icons";
const logo = readFileSync(`${dir}/logo.svg`, "utf8");
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** Logotipo centrado sobre un fondo tinta cuadrado (con margen para íconos "maskable"). */
function tile(size: number, padding: number, radius: number) {
  const art = size - padding * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="#17161C"/>
    <svg x="${padding}" y="${padding}" width="${art}" height="${art}" viewBox="0 0 32 32">${inner}</svg>
  </svg>`);
}

/** Insignia de la barra de estado de Android: silueta blanca con la "P" calada (las insignias usan solo la transparencia). */
const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 32 32">
  <mask id="p"><rect width="32" height="32" fill="#fff"/>
    <path d="M12.4 21.5V8.5H17a4 4 0 0 1 0 8h-4.6" fill="none" stroke="#000" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>
  </mask>
  <path mask="url(#p)" fill="#fff" d="M8 2.5h16a3 3 0 0 1 3 3V29l-2.75-2.6-2.75 2.6-2.75-2.6L16 29l-2.75-2.6-2.75 2.6-2.75-2.6L5 29V5.5a3 3 0 0 1 3-3z"/>
</svg>`);

/** Acceso directo de la app (mantener pulsado el ícono): ícono de Lucide en mostaza sobre tinta. */
function shortcut(name: string) {
  const svg = readFileSync(`node_modules/lucide-static/icons/${name}.svg`, "utf8");
  const art = svg.replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="22" fill="#17161C"/>
    <svg x="24" y="24" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FFC72C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${art}</svg>
  </svg>`);
}

await sharp(tile(192, 26, 40)).png().toFile(`${dir}/icon-192.png`);
await sharp(tile(512, 70, 108)).png().toFile(`${dir}/icon-512.png`);
await sharp(tile(512, 110, 0)).png().toFile(`${dir}/icon-maskable-512.png`);
await sharp(tile(180, 24, 0)).png().toFile(`${dir}/apple-touch-icon.png`);
await sharp(badge).png().toFile(`${dir}/badge-96.png`);
for (const [file, name] of [["orders", "receipt"], ["menu", "utensils"], ["home", "house"]] as const) {
  await sharp(shortcut(name)).png().toFile(`${dir}/shortcut-${file}-96.png`);
}
console.log("Íconos generados en public/assets/icons");
