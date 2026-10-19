/**
 * Genera las llaves VAPID de las notificaciones push:  npm run push:keys
 * Cópialas al .env del servidor (y a tu .env local para probar). La privada es un secreto:
 * nunca la subas al repositorio. Si la cambias, cada dispositivo debe volver a activar los avisos.
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
