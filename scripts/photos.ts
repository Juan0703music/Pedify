/**
 * Fotos de comida de la portada, el panel y el menú de demostración (public/assets/images/food).
 *
 *   npx tsx scripts/photos.ts
 *
 * Todas son de dominio público (CC0): se pueden usar en un producto comercial sin pedir permiso
 * ni dar crédito. Igual se registra la fuente de cada una. Se descargan, se recortan al tamaño
 * de uso y se guardan en WebP (960 y 480 px de ancho) sin metadatos. Los archivos generados se
 * versionan; solo hay que volver a ejecutarlo al agregar o cambiar fotos.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

interface Photo {
  /** Nombre del archivo (sin tamaño ni extensión). */
  name: string;
  /** Qué muestra (texto alternativo de referencia). */
  alt: string;
  url: string;
  source: string;
  author: string;
}

const stocksnap = (code: string) => `https://cdn.stocksnap.io/img-thumbs/960w/${code}.jpg`;

export const PHOTOS: Photo[] = [
  { name: "burger-closeup", alt: "Hamburguesa con tocineta, queso y lechuga", url: stocksnap("2IKZQHEWZ2"), source: "https://stocksnap.io/photo/food-burger-2IKZQHEWZ2", author: "Mali Maeder" },
  { name: "burger-dark", alt: "Hamburguesa con cebolla morada sobre fondo oscuro", url: stocksnap("JSFGN9B9CV"), source: "https://stocksnap.io/photo/ham-burger-JSFGN9B9CV", author: "Toronto Eaters" },
  { name: "burger-classic", alt: "Hamburguesa clásica con queso y tomate", url: stocksnap("BN2YAQSIU1"), source: "https://stocksnap.io/photo/burger-food-BN2YAQSIU1", author: "Sebastián LP" },
  { name: "burger-board", alt: "Hamburguesa con papas a la francesa en tabla de madera", url: stocksnap("7QH4K6AESO"), source: "https://stocksnap.io/photo/hamburger-dinner-7QH4K6AESO", author: "Dana Tentis" },
  { name: "takeaway-combo", alt: "Hamburguesa, papas y gaseosa para llevar", url: stocksnap("EPNYNTYGMD"), source: "https://stocksnap.io/photo/fries-potato-EPNYNTYGMD", author: "Christopher Flowers" },
  { name: "fries-bowl", alt: "Papas a la francesa con queso y perejil", url: stocksnap("G7ZACZQ6O4"), source: "https://stocksnap.io/photo/french-fries-G7ZACZQ6O4", author: "Candace McDaniel" },
  { name: "fries-cup", alt: "Porción de papas a la francesa", url: stocksnap("QCIB3BMQY1"), source: "https://stocksnap.io/photo/food-eat-QCIB3BMQY1", author: "Stephanie McCabe" },
  { name: "fries-sauce", alt: "Papas con pollo y salsas", url: stocksnap("RY64JVIGWS"), source: "https://stocksnap.io/photo/french-fries-RY64JVIGWS", author: "Candace McDaniel" },
  { name: "sausages-grill", alt: "Salchichas y chorizos en la parrilla", url: stocksnap("CA73AK1Z4G"), source: "https://stocksnap.io/photo/food-meat-CA73AK1Z4G", author: "Markus Spiske" },
  {
    name: "hotdog-classic",
    alt: "Perro caliente con mostaza y papas fritas",
    url: "https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvZmw1MDA2OTQ2MjkwMy1pbWFnZS1reWNpcmpnYi5qcGc.jpg",
    source: "https://www.rawpixel.com/image/6075294/hot-dogs",
    author: "rawpixel",
  },
  {
    name: "hotdog-loaded",
    alt: "Perro caliente con queso gratinado, cebolla y tomate",
    url: "https://images.rawpixel.com/editor_1024/czNmcy1wcml2YXRlL3Jhd3BpeGVsX2ltYWdlcy93ZWJzaXRlX2NvbnRlbnQvbHIvYTAxOS1qYWt1YmstMDcxMy1hd2Vzb21lLWJlZWYtaG90LWRvZzEuanBn.jpg",
    source: "https://www.rawpixel.com/image/448224/free-photo-image-sandwich-bread-hot-dog",
    author: "Jakub Kapusnak",
  },
  { name: "pizza-slices", alt: "Pizza en porciones vista desde arriba", url: stocksnap("5BADCUBZS9"), source: "https://stocksnap.io/photo/sliced-homemade-5BADCUBZS9", author: "Snapwire" },
  { name: "pizza-box", alt: "Pizza en su caja para domicilio", url: stocksnap("R0YJRQ45E0"), source: "https://stocksnap.io/photo/pizza-food-R0YJRQ45E0", author: "Krzysztof Puszczyński" },
  { name: "pizza-oven", alt: "Pizza saliendo del horno de leña", url: stocksnap("F7EPDH2L1A"), source: "https://stocksnap.io/photo/rustic-pizza-F7EPDH2L1A", author: "Eneida Nieves" },
  { name: "juice-orange", alt: "Jugo natural de naranja con limones", url: stocksnap("HKVEPULXQZ"), source: "https://stocksnap.io/photo/lemon-juice-HKVEPULXQZ", author: "WDnet Studio" },
  { name: "drink-jar", alt: "Bebida fría en frasco con pitillo", url: stocksnap("Z330CKC9VK"), source: "https://stocksnap.io/photo/glass-juice-Z330CKC9VK", author: "Lisa Fotios" },
  { name: "soda-glass", alt: "Gaseosa con hielo en vaso", url: stocksnap("H57MU5YDCI"), source: "https://stocksnap.io/photo/soda-softdrink-H57MU5YDCI", author: "Agnieszka Bladzik" },
  { name: "cake-birthday", alt: "Torta de cumpleaños con velas y chispas", url: stocksnap("W7T1J6B7DM"), source: "https://stocksnap.io/photo/birthday-cake-W7T1J6B7DM", author: "Altered Reality" },
  { name: "cake-coffee", alt: "Porción de torta con café", url: stocksnap("A48UPBB6XM"), source: "https://stocksnap.io/photo/carrot-cake-A48UPBB6XM", author: "Lisa Fotios" },
  { name: "chicken-grill", alt: "Pollo asado recién salido de la parrilla", url: stocksnap("ZKP84YCBWQ"), source: "https://stocksnap.io/photo/grilled-chicken-ZKP84YCBWQ", author: "NeONBRAND" },
  { name: "friends-table", alt: "Amigos compartiendo hamburguesas y papas", url: stocksnap("5YHRDJ0VRZ"), source: "https://stocksnap.io/photo/restaurant-people-5YHRDJ0VRZ", author: "Dan Gold" },
  { name: "grill-fire", alt: "Carnes de hamburguesa en la parrilla con fuego", url: stocksnap("WOA0EWC9HM"), source: "https://stocksnap.io/photo/burger-food-WOA0EWC9HM", author: "David Mcbee" },
  { name: "chef-kitchen", alt: "Cocina de restaurante en servicio", url: stocksnap("0HCMIT272C"), source: "https://stocksnap.io/photo/restaurant-kitchen-0HCMIT272C", author: "Michael Browning" },
];

const OUT_DIR = path.join(process.cwd(), "public/assets/images/food");
const WIDTHS = [960, 480];
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function download(photo: Photo): Promise<Buffer> {
  // StockSnap solo entrega sus imágenes con la página de origen como referencia.
  const response = await fetch(photo.url, { headers: { "User-Agent": USER_AGENT, Referer: new URL(photo.source).origin + "/" } });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/")) throw new Error(`${photo.name}: ${response.status} ${type}`);
  return Buffer.from(await response.arrayBuffer());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const photo of PHOTOS) {
    const source = await download(photo);
    for (const width of WIDTHS) {
      await sharp(source)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: width > 500 ? 74 : 70, effort: 6 })
        .toFile(path.join(OUT_DIR, `${photo.name}-${width}.webp`));
    }
    console.log(`✓ ${photo.name}`);
  }
  console.log(`${PHOTOS.length} fotos en public/assets/images/food`);
}
