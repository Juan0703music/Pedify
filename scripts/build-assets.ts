/**
 * Genera los recursos estáticos que se publican en public/assets:
 *   - fonts/archivo-latin-wdth.woff2  (Archivo variable: peso 100–900 y ancho 62–125 %; licencia OFL)
 *   - icons/sprite.svg                (íconos Lucide, licencia ISC)
 *
 *   npx tsx scripts/build-assets.ts
 *
 * Los archivos generados se versionan; solo hay que volver a ejecutarlo al agregar íconos.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ICONS = [
  "arrow-down", "arrow-right", "arrow-up", "arrow-up-down", "archive", "archive-restore", "banknote", "bell", "bell-off", "bell-ring",
  "bike", "calendar", "camera", "chart-column", "check", "chef-hat", "chevron-down", "chevron-up", "chevrons-up-down",
  "circle-alert", "circle-check", "circle-x", "credit-card", "clock", "copy", "download", "ellipsis", "external-link", "eye", "eye-off",
  "flame", "folder-plus", "history", "house", "image", "image-plus", "info", "key-round", "link", "list-checks", "loader-circle", "lock",
  "log-out", "map-pin", "menu", "minus", "message-circle", "navigation", "package", "pencil", "phone", "plus", "qr-code",
  "receipt", "search", "settings", "share-2", "shield", "shopping-bag", "smartphone", "store", "tag",
  "trash-2", "trending-down", "trending-up", "truck", "upload", "user-plus", "users", "utensils", "wallet", "wifi-off", "x",
];

const root = process.cwd();
const assets = path.join(root, "public/assets");

mkdirSync(path.join(assets, "fonts"), { recursive: true });
copyFileSync(
  path.join(root, "node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2"),
  path.join(assets, "fonts/archivo-latin-wdth.woff2"),
);

const symbols = ICONS.map((name) => {
  const svg = readFileSync(path.join(root, "node_modules/lucide-static/icons", `${name}.svg`), "utf8");
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/\s*\n\s*/g, "");
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
});

mkdirSync(path.join(assets, "icons"), { recursive: true });
writeFileSync(
  path.join(assets, "icons/sprite.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n<!-- Íconos de Lucide (https://lucide.dev), licencia ISC. Generado por scripts/build-assets.ts -->\n${symbols.join("\n")}\n</svg>\n`,
);

console.log(`Fuente copiada y ${ICONS.length} íconos en public/assets/icons/sprite.svg`);
