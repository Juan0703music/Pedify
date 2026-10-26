import { networkInterfaces } from "node:os";
import { env } from "./env.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Redes de casa u oficina primero (192.168…, 10…); las 172.16–31 suelen ser de Docker o máquinas virtuales.
const PREFERRED_NETWORKS = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** IPv4 del computador en la red local (Wi-Fi o cable), si está conectado a una. */
function lanAddress(): string | undefined {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((address) => address?.family === "IPv4" && !address.internal)
    .map((address) => address!.address);
  const rank = (address: string) => {
    const index = PREFERRED_NETWORKS.findIndex((network) => network.test(address));
    return index === -1 ? PREFERRED_NETWORKS.length : index;
  };
  return addresses.sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Dirección de Pedify para abrir en otro dispositivo: el enlace y los QR de la tienda y de las mesas, el
 * enlace del domiciliario y el QR de la app. En desarrollo APP_URL es http://localhost:3000, que en el
 * celular no abre nada (allí «localhost» es el propio celular): se usa la IP del computador en la red,
 * y un celular conectado al mismo Wi-Fi abre la tienda. En pruebas y producción es siempre APP_URL.
 */
export function publicAppUrl(): string {
  const url = new URL(env.APP_URL);
  if (env.NODE_ENV === "development" && LOOPBACK_HOSTS.has(url.hostname)) {
    const address = lanAddress();
    if (address) url.hostname = address;
  }
  return url.origin;
}
