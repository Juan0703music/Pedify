# API v1

Base: `/api/v1`. JSON en ambos sentidos. La sesión viaja en una cookie `httpOnly` que el servidor fija al registrarse o iniciar sesión.

## Formato de respuestas

```json
{ "data": { … } }
```

Errores:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Revisa los datos ingresados.", "fields": { "email": "Escribe un correo válido." } } }
```

| Estado | Códigos frecuentes |
|---|---|
| 400 | `INVALID_TRANSITION`, `ORDER_CANCELLED`, `VALIDATION_ERROR`, `INVALID_JSON`, `NO_DELIVERY_MODE`, `PASSWORD_REQUIRED`, `CATEGORY_NOT_FOUND`, `IMAGE_REQUIRED`, `DELIVERY_UNAVAILABLE`, `PICKUP_UNAVAILABLE`, `PAYMENT_METHOD_NOT_ACCEPTED`, `MINIMUM_ORDER`, `QUANTITY_LIMIT`, `LOCATION_REQUIRED`, `DELIVERY_TIERS_REQUIRED`, `DELIVERY_OUT_OF_RANGE` |
| 401 | `UNAUTHORIZED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN` (otro origen), `NOT_A_MEMBER`, `ROLE_REQUIRED`, `NO_ACTIVE_BUSINESS`, `BUSINESS_SUSPENDED`, `INVALID_PASSWORD` |
| 404 | `NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `STORE_NOT_FOUND`, `ORDER_NOT_FOUND`, `CUSTOMER_NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `SLUG_TAKEN`, `ALREADY_MEMBER`, `LAST_OWNER`, `DUPLICATE`, `CATEGORY_EXISTS`, `ORDER_OUTDATED`, `PRODUCT_ARCHIVED`, `PRODUCT_LIMIT`, `CATEGORY_LIMIT`, `STORE_CLOSED`, `ORDERS_PAUSED`, `PRODUCTS_UNAVAILABLE`, `STATUS_CHANGED`, `DELIVERY_NOT_CONFIGURED` |
| 413 | `IMAGE_TOO_LARGE` (más de 8 MB), `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_IMAGE` |
| 429 | `TOO_MANY_REQUESTS` |

Las peticiones que modifican datos (`POST`, `PATCH`, `DELETE`) desde otro sitio se rechazan con 403.

Teléfonos: se aceptan en cualquier formato colombiano (`300 123 4567`, `+57 300-123-4567`) y se devuelven normalizados (`573001234567`). Dinero: enteros en COP.

## Salud

`GET /health` → `{ "data": { "status": "ok" } }` (verifica la base de datos).

## Autenticación — `/auth`

| Método | Ruta | Sesión | Cuerpo | Respuesta |
|---|---|---|---|---|
| POST | `/auth/register` | — | `name, email, password, businessName, businessPhone` | 201 perfil + cookie |
| POST | `/auth/login` | — | `email, password` | 200 perfil + cookie |
| GET | `/auth/me` | ✔ | — | perfil: `user`, `businesses`, `activeBusinessId` y `newBusiness { allowed, owned, max, planName, message }` (si puede crear otro negocio según su plan) |
| PATCH | `/auth/me` | ✔ | `name` | `{ user }` |
| POST | `/auth/switch-business` | ✔ | `businessId` | perfil con el nuevo negocio activo |
| PATCH | `/auth/password` | ✔ | `currentPassword, newPassword` | `{ ok }`; cierra las demás sesiones |
| POST | `/auth/logout` | ✔ | — | 204 |
| POST | `/auth/logout-all` | ✔ | — | 204; cierra todas las sesiones |
| POST | `/auth/forgot-password` | — | `email` | `{ ok }` siempre (no revela si existe la cuenta); envía un enlace de 30 min |
| POST | `/auth/reset-password` | — | `token, newPassword` | `{ ok }`; cierra todas las sesiones · 400 `RESET_LINK_INVALID` |

`POST /auth/register` exige `acceptPrivacy: true` (autorización de tratamiento de datos, Ley 1581) y crea el negocio con 7 días de prueba del plan `plan` (`EMPRENDEDOR`, `NEGOCIO` o `EMPRESA`; opcional, por defecto `NEGOCIO`). El perfil incluye `user.isPlatformAdmin`.

Perfil:

```json
{
  "user": { "id": "…", "name": "Ana Pérez", "email": "ana@ejemplo.com", "createdAt": "…" },
  "businesses": [{ "id": "…", "name": "Sabores del Caribe", "slug": "sabores-del-caribe", "status": "ACTIVE", "role": "OWNER" }],
  "activeBusinessId": "…"
}
```

## Negocios — `/businesses`

Todas requieren sesión. Las rutas `/current…` actúan sobre el **negocio activo** y verifican la membresía en cada petición.

| Método | Ruta | Rol | Cuerpo |
|---|---|---|---|
| GET | `/businesses` | — | Negocios del usuario |
| POST | `/businesses` | — | `name, phone` → crea otro negocio (queda activo, con su propia prueba). 409 `PLAN_LIMIT` si ya tiene los negocios que permite su plan (Emprendedor 1, Negocio 3, Empresa ilimitados; cuenta el plan más amplio entre los negocios de los que es propietario) |
| GET | `/businesses/current` | miembro | — |
| PATCH | `/businesses/current` | OWNER | `name, phone, slug, description, city, address` (parcial) |
| GET | `/businesses/current/settings` | miembro | — |
| PATCH | `/businesses/current/settings` | OWNER | `openingHours, acceptingOrders, whatsappPhone, deliveryEnabled, deliveryPricing, deliveryFee, deliveryTiers, deliveryExtraKmFee, deliveryMaxKm, location, deliveryArea, pickupEnabled, dineInEnabled, minimumOrder, paymentMethods, salesPolicy` (parcial). Ver «Domicilio según la distancia» |
| GET | `/businesses/current/members` | OWNER | — |
| POST | `/businesses/current/members` | OWNER | `name, email, password?, role` |
| PATCH | `/businesses/current/members/:membershipId` | OWNER | `role` |
| DELETE | `/businesses/current/members/:membershipId` | OWNER | — |

| POST | `/businesses/current/logo` | OWNER | imagen (cuerpo binario, ver [Imágenes](#imágenes)) |
| DELETE | `/businesses/current/logo` | OWNER | — |
| POST | `/businesses/current/banner` | OWNER | imagen (portada) |
| DELETE | `/businesses/current/banner` | OWNER | — |
| GET | `/businesses/current/qr?format=svg\|png&download=1&mesa=&local=1` | miembro | Código QR del enlace de la tienda (imagen). Con `mesa=4`, el de esa mesa (`/tienda/<slug>?mesa=4`); con `local=1`, el general del local (`?local=1`) |

`GET /businesses/current` incluye `storeUrl` (`<APP_URL>/tienda/<slug>`), `logoUrl`, `bannerUrl`, el `role` del usuario y `subscription` (`plan, planName, status, endsAt, daysLeft, graceEndsAt, canReceiveOrders`).

Métodos de pago: `CASH`, `NEQUI`, `DAVIPLATA`, `BANK_TRANSFER`, `CARD`.

Ejemplo de configuración:

```http
PATCH /api/v1/businesses/current/settings
Content-Type: application/json

{
  "openingHours": [
    { "day": 0, "closed": false, "open": "17:00", "close": "23:30" },
    { "day": 1, "closed": true,  "open": "17:00", "close": "23:30" },
    …
  ],
  "whatsappPhone": "315 555 0101",
  "deliveryFee": 4000,
  "paymentMethods": ["CASH", "NEQUI"]
}
```

### Domicilio según la distancia

- `deliveryPricing`: `FIXED` (cobra `deliveryFee` a todos) o `DISTANCE` (cobra según la distancia en línea recta desde el negocio hasta la ubicación que comparte el cliente).
- `deliveryTiers`: hasta 8 rangos `{ upToKm, fee }` de menor a mayor (`upToKm` con un decimal, máx. 50 km): se cobra el primer rango que cubre la distancia.
- `deliveryExtraKmFee`: más allá del último rango, valor por cada km adicional empezado (así llega a **toda la ciudad**); `null` = no se lleva más lejos del último rango.
- `deliveryMaxKm`: distancia máxima (km, hasta 50); `null` = toda la ciudad, hasta el tope de 50 km en línea recta. La distancia se toma de a 100 m.
- `location`: `{ lat, lng }` del negocio (punto de partida) o `null`.
- Con `DISTANCE` son obligatorios la ubicación (400 `LOCATION_REQUIRED`) y al menos un rango (400 `DELIVERY_TIERS_REQUIRED`). La respuesta trae `deliveryTiers` ordenados y `location`.

```json
{ "deliveryPricing": "DISTANCE", "location": { "lat": 9.3047, "lng": -75.3978 },
  "deliveryTiers": [ { "upToKm": 2, "fee": 4000 }, { "upToKm": 4, "fee": 5500 }, { "upToKm": 6, "fee": 7000 }, { "upToKm": 8, "fee": 8500 } ],
  "deliveryExtraKmFee": 1000, "deliveryMaxKm": null }
```

Con esos valores (los sugeridos en el panel): a 1 km $4.000, a 5 km $7.000, a 8 km $8.500, a 12 km $12.500 y a 20 km $20.500.

## Productos — `/products`

Menú del negocio activo (sección 4 del documento). Todas requieren sesión.

| Método | Ruta | Rol | Cuerpo / consulta | Respuesta |
|---|---|---|---|---|
| GET | `/products?status=current\|archived` | miembro | — | Lista ordenada por `position` |
| GET | `/products/summary` | miembro | — | `{ total, visible, soldOut, withImage }` |
| POST | `/products` | OWNER | `name, price, description?, categoryId?, isActive?, isAvailable?` | 201 producto (al final de su categoría) |
| GET | `/products/:id` | miembro | — | producto |
| PATCH | `/products/:id` | OWNER · EMPLOYEE solo `isAvailable` | campos parciales | producto |
| DELETE | `/products/:id` | OWNER | — | `{ result: "deleted" }` o `{ result: "archived" }` si aparece en pedidos |
| POST | `/products/:id/restore` | OWNER | — | producto archivado de vuelta al menú |
| PUT | `/products/order` | OWNER | `categoryId (null = sin categoría), productIds[]` | 204 |
| POST | `/products/:id/image` | OWNER | imagen (cuerpo binario) | producto con `imageUrl` |
| DELETE | `/products/:id/image` | OWNER | — | producto sin foto |

Producto:

```json
{
  "id": "…", "categoryId": "…", "name": "Hamburguesa especial", "description": "…",
  "price": 18000, "imageUrl": "/uploads/businesses/…/products/…/k3J….webp",
  "isActive": true, "isAvailable": true, "position": 0, "archivedAt": null,
  "createdAt": "…", "updatedAt": "…"
}
```

- `isActive`: visible en la tienda. `isAvailable`: `false` = agotado (se muestra como tal en la tienda).
- `price`: entero en COP, mayor que 0.
- Al cambiar `categoryId`, el producto pasa al final de la nueva categoría.
- `PUT /products/order` recibe el orden **completo** de una categoría; si la lista no coincide con los productos actuales (otra persona cambió el menú) responde 409 `ORDER_OUTDATED`.
- Límite: 500 productos vigentes por negocio.

## Categorías — `/categories`

| Método | Ruta | Rol | Cuerpo | Respuesta |
|---|---|---|---|---|
| GET | `/categories` | miembro | — | `[{ id, name, position, productCount }]` |
| POST | `/categories` | OWNER | `name` | 201 categoría (al final) |
| PATCH | `/categories/:id` | OWNER | `name` | categoría |
| DELETE | `/categories/:id` | OWNER | — | `{ movedProducts }`: sus productos pasan, en orden, a «Sin categoría» |
| PUT | `/categories/order` | OWNER | `categoryIds[]` (todas) | 204 |
| PUT | `/categories/:id/products` | OWNER | `productIds[]` (0–500, sin repetidos) | `{ added, removed, productCount }` |

`PUT /categories/:id/products` («Elegir productos» en Mi menú) deja en la categoría exactamente los productos indicados: los que ya estaban conservan su orden, los nuevos llegan al final (en el orden de la lista) y los que salen pasan al final de «Sin categoría». Todo en una transacción. Si algún producto no existe, es de otro negocio o está archivado → 400 `PRODUCT_NOT_FOUND` y no se cambia nada.

Los nombres no se repiten dentro de un negocio sin importar mayúsculas (`Bebidas` = `bebidas` → 409 `CATEGORY_EXISTS`). Límite: 50 categorías.

## Imágenes

Las fotos se envían como **cuerpo binario** de la petición (sin `multipart`):

```js
await fetch("/api/v1/products/<id>/image", { method: "POST", headers: { "Content-Type": file.type }, body: file });
```

- Máximo 8 MB (413 `IMAGE_TOO_LARGE`). Formatos: JPG, PNG, WebP, AVIF, GIF (primer cuadro). Se valida decodificando la imagen, no por el `Content-Type` (415 `UNSUPPORTED_IMAGE`).
- El servidor corrige la orientación, reduce el tamaño (producto ≤ 800 px, logo 512 × 512 recortado al centro, portada ≤ 1600 px), convierte a WebP y elimina los metadatos.
- Cada versión recibe un nombre aleatorio nuevo y se sirve con caché de un año (`immutable`); la versión anterior se borra.
- Límite: 60 subidas cada 15 minutos por IP.

## Seguimiento del domiciliario en el mapa

Para pedidos a domicilio. El cliente puede marcar su punto exacto al pedir (`location: { lat, lng }` en `POST /store/:slug/orders`); el negocio genera un enlace para el domiciliario, que lo abre en su celular **sin cuenta** y comparte su ubicación mientras el pedido va en camino. Solo se guarda la última posición; al entregar o cancelar se borran la del domiciliario y el punto del cliente, y el enlace deja de funcionar.

| Método | Ruta | Quién | Respuesta |
|---|---|---|---|
| POST | `/orders/:id/courier-link` | equipo del negocio | 201 `{ url, expiresAt, qrSvg }`. URL `…/domicilio#<clave>`; vence en 12 h. Generar otro invalida el anterior. Solo domicilios (`NOT_DELIVERY`) no terminados (`ORDER_FINISHED`) |
| GET | `/courier` | domiciliario (`X-Courier-Key`) | Número, negocio, cliente (nombre, celular, dirección, referencias, notas), `destination`, productos, total, método de pago, `paid`, `paymentProofSent` (pagó por adelantado), `position`, `map`, `paymentAccounts` (QR y llaves de cobro del negocio) y `suggestedAccount` (`NEQUI`, `DAVIPLATA` o `BRE_B` según cómo dijo el cliente que pagaría; `null` en efectivo o datáfono) |
| POST | `/courier/location` | domiciliario | `{ lat, lng, accuracy?, heading? }` → 204. Solo con el pedido «En camino» (409 `NOT_ON_THE_WAY`) |
| POST | `/courier/delivered` | domiciliario | 204: el pedido pasa a «Entregado» (historial: «Entregado por el domiciliario») |
| GET | `/map-config` | público | `{ tileUrl, attribution }` (`MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`) |

- La clave viaja en la cabecera `X-Courier-Key` (en la página va después de `#`, así que no llega a los registros del servidor). Clave inválida, vencida o de un pedido terminado → 404 `COURIER_LINK_INVALID`. Límite: 400 peticiones cada 10 minutos por IP.
- El seguimiento del cliente (`GET /store/:slug/orders/:id`) incluye `destination` (su punto) y `courier` (`{ lat, lng, accuracy, heading, updatedAt }` solo mientras va «En camino»). El detalle del panel incluye `deliveryLat`, `deliveryLng` y `courier`.

## Cobrar con QR — `/businesses/current/payment-accounts`

El negocio sube el QR para recibir pagos que le da su app (Nequi, la llave **Bre-B** de cualquier banco o Daviplata); un pantallazo sirve. El servidor lee el código de la imagen y lo devuelve dibujado de nuevo (`qrSvg`), así se ve nítido en la tienda y en la pantalla del domiciliario. Pedify no genera códigos de pago propios: usa exactamente el que emitió el banco. Ese QR no lleva el valor: el cliente escribe el total al pagar.

Con cuentas configuradas, **Nequi, Daviplata y transferencia se pagan antes de enviar el pedido** (ver «Pago por adelantado» más abajo). Efectivo y datáfono se siguen pagando al recibir.

| Método | Ruta | Quién | Cuerpo / respuesta |
|---|---|---|---|
| GET | `/businesses/current/payment-accounts` | OWNER | `[{ kind, label, accountKey, holderName, qrSvg, qrImageUrl }]` en orden Nequi, Bre-B, Daviplata (solo las configuradas) |
| PUT | `/businesses/current/payment-accounts/:kind` | OWNER | `{ accountKey?, holderName? }` (número o llave de 3 a 80 caracteres; `""` lo borra). Crea la cuenta si no existía |
| POST | `/businesses/current/payment-accounts/:kind/qr` | OWNER | Imagen en binario (como las fotos). 422 `QR_NOT_FOUND` si no hay un QR legible; 422 `QR_TOO_LONG` si el código no parece de cobro. Reemplaza la imagen anterior |
| DELETE | `/businesses/current/payment-accounts/:kind` | OWNER | 204 (borra el QR y la llave). 404 `PAYMENT_ACCOUNT_NOT_FOUND` |

`:kind` es `NEQUI`, `BRE_B` o `DAVIPLATA`. El contenido leído del QR no se expone tal cual (solo su dibujo en SVG) y la clave de la imagen nunca sale en la API.

## Pago por adelantado con comprobante

Para cada método por transferencia que acepta el negocio, la tienda (`GET /store/:slug`) trae en `payments.prepay` las cuentas que se le muestran al cliente: la del método y la llave Bre-B, que se paga desde cualquier banco o billetera (por ejemplo `{ "NEQUI": ["NEQUI", "BRE_B"], "BANK_TRANSFER": ["BRE_B"] }`), y en `payments.accounts` sus datos (`kind, label, accountKey, holderName, qrSvg`). Un método que aparece en `prepay` exige comprobante; uno que no aparece se paga al recibir.

| Método | Ruta | Quién | Respuesta |
|---|---|---|---|
| POST | `/store/:slug/payment-proofs?total=` | público | Imagen en binario (pantallazo del comprobante, máx. 8 MB) → 201 `{ id, createdAt, reading }`. `reading` (o `null` si la lectura no alcanzó a terminar en 6 s): `{ amount, matchesTotal }`, el valor leído comparado con `total` (lo que el cliente va a pagar). 409 `PREPAY_NOT_AVAILABLE` si el negocio no cobra por adelantado. Límite: 20 cada 15 minutos por IP |
| GET | `/store/:slug/payment-qr/:kind.png` | público | El QR de esa cuenta en PNG (descarga), para subirlo en la app del banco cuando se pide desde el mismo celular. 404 `PAYMENT_QR_NOT_FOUND` |
| GET | `/orders/:id/payment-proof` | equipo del negocio | La imagen del comprobante (`image/webp`, `Cache-Control: private, no-store`). 404 `PAYMENT_PROOF_NOT_FOUND` |

- Al crear el pedido se envía `paymentProofId`. Sin él → 400 `PAYMENT_PROOF_REQUIRED` (`details.fields.paymentProof`); si es de otro negocio, ya se usó o tiene más de 24 horas → 400 `PAYMENT_PROOF_INVALID`. El comprobante queda unido al pedido: `paymentProof: { createdAt, checkStatus }` en el pedido del panel y en la respuesta de creación; el detalle (`GET /orders/:id`) trae además `checks`.
- **Verificación automática**: al subirlo, Pedify lee el comprobante (OCR con Tesseract, en el servidor) y, con el pedido creado, revisa: que sea un pago exitoso, el **valor** (igual al total), el **destinatario** (el celular, la llave Bre-B o el nombre del titular de una de las cuentas del negocio), la **fecha y hora** (de hoy, hasta 3 horas antes de subirlo) y que **no se haya usado** en otro pedido (el mismo archivo o la misma referencia). `checkStatus`: `PENDING` (leyendo), `VERIFIED` (todo coincide), `REVIEW` (no se pudo leer algún dato) o `MISMATCH` (algo no coincide). `checks`: `[{ key: "receipt" | "amount" | "recipient" | "date" | "unique", ok: true | false | null, title, detail }]`. Al terminar se emite `order:updated` para que el panel se actualice. Es una revisión del comprobante: la confirmación definitiva es ver el dinero en la cuenta.
- El negocio compara el comprobante con su app y marca el pedido como pagado (`PATCH /orders/:id/payment`). El seguimiento del cliente muestra `paymentProofSent` y `paid`; la vista del domiciliario, `paymentProofSent` (no cobra) y `paymentProofStatus` (si no coincide, debe confirmar con el negocio antes de entregar).
- Las imágenes son privadas: se guardan en `private/…` del almacenamiento, nunca en `/uploads` (404) y solo se leen por la API. Los comprobantes que no se usan en un pedido se borran al día siguiente; al suprimir los datos de un cliente se borran los de sus pedidos.

## Roles y permisos

- **Propietario** (`OWNER`): puede todo.
- **Empleado** (`EMPLOYEE`): atiende pedidos (`/orders`) siempre. Además, lo que el propietario le permita en Configuración → Equipo:

| Permiso | Abre | Inicial |
|---|---|---|
| `markSoldOut` | `PATCH /products/:id` con solo `isAvailable` | sí |
| `viewSales` | `GET /analytics/today` (ventas del día en Inicio) | sí |
| `viewCustomers` | `GET /customers`, `GET /customers/:id` | sí |
| `viewAnalytics` | `GET /analytics/summary` | no |

- Siempre solo del propietario: editar el menú y las categorías, configurar el negocio (datos, horario, entrega, pagos, ventas, logo, portada), el equipo, el plan y borrar los datos de un cliente.
- Sin el permiso → 403 `PERMISSION_REQUIRED` con el motivo. `GET /businesses/current` incluye `role` y `permissions` (el propietario, todos en `true`).
- Equipo: `POST /businesses/current/members` acepta `permissions` (parcial, sobre los iniciales) y responde con `existingAccount`: si el correo ya tenía cuenta en Pedify, solo se vincula al negocio y la persona entra con **su** contraseña (la contraseña inicial enviada se ignora; un propietario nunca puede cambiar la contraseña de una cuenta existente); `PATCH /businesses/current/members/:id` acepta `role` y/o `permissions`. Los miembros se devuelven con `permissions`.
- **Iniciar sesión con el rol**: `POST /auth/login` acepta `as: "OWNER" | "EMPLOYEE"` («Soy el dueño» / «Soy empleado»). No da permisos: si la cuenta no tiene ese rol en ningún negocio → 403 `ROLE_MISMATCH` y no se abre sesión (con contraseña equivocada sigue siendo 401, sin revelar el rol). Si la persona es dueña de un negocio y empleada de otro, empieza en el negocio del rol que eligió.

## Avisos push — `/push`

Sesión de cualquier persona del equipo (propietario o empleado). Web Push con llaves VAPID; el service worker es `/sw.js`.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/push/public-key` | — | `{ enabled, publicKey }` (`enabled: false` si el servidor no tiene llaves) |
| POST | `/push/subscriptions` | `{ endpoint, keys: { p256dh, auth } }` (lo que entrega `PushManager.subscribe()`) | 201 `{ devices }` — se asocia a la persona y a su negocio activo |
| DELETE | `/push/subscriptions` | `{ endpoint }` | 204 |
| POST | `/push/test` | — | `{ sent, devices }` — aviso de prueba a sus dispositivos |

- `endpoint` debe ser `https://` de un servicio de push conocido (Google FCM, Mozilla, Apple, Microsoft); cualquier otra dirección → 400 (el servidor no hace peticiones a direcciones arbitrarias).
- Con cada pedido nuevo se avisa a los dispositivos de las personas que **siguen** en el equipo: título `Nuevo pedido #N`, cuerpo `Nombre · Domicilio|Para recoger · $total`, abre `/panel/pedidos?pedido=<id>`. Los dispositivos que el servicio rechaza (404/410) se borran.
- Sin llaves VAPID: `POST /push/subscriptions` y `/push/test` → 409 `PUSH_DISABLED`.

## Tienda pública — `/store`

Sin sesión.

`GET /store/:slug` → 200 (caché pública de 15 s) o 404 `STORE_NOT_FOUND` (no existe o el negocio está suspendido).

```json
{
  "business": { "name": "Sabores del Caribe", "slug": "sabores-del-caribe", "description": "…", "city": "Sincelejo",
                "address": "Calle 20 #15-30", "phone": "573001234567", "logoUrl": null, "bannerUrl": null },
  "settings": { "openingHours": [ … ], "timezone": "America/Bogota", "whatsappPhone": "573001234567",
                "deliveryEnabled": true, "deliveryPricing": "FIXED", "deliveryFee": 4000, "deliveryTiers": [], "location": null,
                "deliveryArea": "Todo Sincelejo",
                "pickupEnabled": true, "minimumOrder": 15000, "paymentMethods": ["CASH", "NEQUI"] },
  "status": { "isOpen": false, "closesAt": null, "nextOpen": { "inDays": 1, "day": 2, "time": "17:00" },
              "acceptingOrders": true, "canOrder": false },
  "categories": [
    { "id": "…", "name": "Hamburguesas", "products": [
      { "id": "…", "name": "Hamburguesa especial", "description": "…", "price": 18000, "imageUrl": null, "isAvailable": true }
    ] },
    { "id": null, "name": "Otros productos", "products": [ … ] }
  ],
  "featured": { "kind": "popular", "productIds": ["…", "…", "…"] },
  "payments": { "prepay": { "NEQUI": ["NEQUI", "BRE_B"] }, "accounts": [{ "kind": "NEQUI", "label": "Nequi", "accountKey": "300 123 4567", "holderName": "Ana Pérez", "qrSvg": "<svg…" }, …] }
}
```

- Solo incluye productos visibles (`isActive`) y no archivados; los agotados aparecen con `isAvailable: false`. Las categorías sin productos visibles se omiten; los productos sin categoría van al final.
- `featured` alimenta el carrusel de la tienda: con `kind: "popular"`, los productos más vendidos de los últimos 30 días (pedidos confirmados en adelante; nunca pendientes ni cancelados), de mayor a menor cantidad; solo entran los que tienen foto y están disponibles, hasta 8. Si hay menos de 3, `kind: "photos"` con los productos con foto en el orden del menú.
- `status` se calcula con el horario en la zona horaria del negocio. `nextOpen.inDays`: 0 = hoy, 1 = mañana… `canOrder` = abierto y sin pausa manual (se usará en la fase 3).

## Pedidos desde la tienda — `/store/:slug/orders`

Sin sesión (secciones 4, 8 y 9 del documento). Límite: 15 pedidos cada 10 minutos por IP. Las peticiones desde otro sitio web se rechazan (403).

### `POST /store/:slug/orders`

```json
{
  "idempotencyKey": "9f2c4e0b7a1d4c3e8b5a6f7d8e9c0b1a",
  "items": [{ "productId": "…", "quantity": 1 }, { "productId": "…", "quantity": 2 }],
  "name": "Luis Gómez",
  "phone": "311 222 3344",
  "deliveryType": "DELIVERY",
  "address": "Calle 20 #15-30",
  "references": "Casa azul",
  "paymentMethod": "CASH",
  "notes": "Sin cebolla"
}
```

Con Nequi, Daviplata o transferencia y cuentas configuradas, además `"paymentProofId": "…"` (ver «Pago por adelantado con comprobante»).

- Solo se reciben productos y cantidades. Precios, subtotal, domicilio, descuento y total los calcula el servidor; cualquier valor monetario enviado se descarta.
- `idempotencyKey`: la genera el navegador por intento de compra (16–80 caracteres `A-Z a-z 0-9 -`). Si llega de nuevo, se responde **200** con el pedido ya creado, sin duplicarlo.
- `phone`: celular colombiano (se normaliza a `57XXXXXXXXXX`). `address` es obligatoria para `DELIVERY` y se ignora en `PICKUP` y `DINE_IN`.
- **Comer en el local** (`deliveryType: "DINE_IN"`, con `tableNumber` opcional de hasta 20 caracteres): el cliente pide desde su mesa con el QR del local. Sin domicilio ni pedido mínimo; 400 `DINE_IN_UNAVAILABLE` si el negocio apagó `dineInEnabled`. Se atiende como para recoger (listo → servido, sin domiciliario) y el pedido trae `tableNumber`.
- Domicilio según la distancia (`settings.deliveryPricing: "DISTANCE"`, con `deliveryTiers` y la `location` del negocio en `GET /store/:slug`): el pedido a domicilio debe traer `location` del cliente (400 `LOCATION_REQUIRED`) dentro del alcance (400 `DELIVERY_OUT_OF_RANGE`: «Tu ubicación está a 9 km y … lleva domicilios hasta 6 km»). La tienda publica `deliveryExtraKmFee`, `deliveryReachKm` (hasta dónde llega) y `deliveryWholeCity`. El servidor calcula el valor y guarda la distancia en `deliveryDistanceM` (también con tarifa fija si el negocio y el cliente marcaron su ubicación).
- Reglas: el negocio debe estar abierto según su horario (`STORE_CLOSED`) y sin pausa (`ORDERS_PAUSED`); no necesita WhatsApp: el pedido llega directo al panel; la modalidad y el método de pago deben estar habilitados; el subtotal debe cubrir el pedido mínimo (`MINIMUM_ORDER`); cada producto debe ser del negocio, visible, no archivado y disponible (`PRODUCTS_UNAVAILABLE`, con `details.products: [{ productId, name, reason: "sold_out" | "not_found" }]`).

Respuesta **201**:

```json
{
  "order": {
    "id": "…", "number": 12, "status": "PENDING", "deliveryType": "DELIVERY",
    "customerName": "Luis Gómez", "customerPhone": "573112223344",
    "deliveryAddress": "Calle 20 #15-30", "addressReferences": "Casa azul",
    "paymentMethod": "CASH", "notes": "Sin cebolla",
    "subtotal": 41000, "deliveryFee": 4000, "discount": 0, "total": 45000,
    "whatsappOpenedAt": null, "createdAt": "…",
    "items": [{ "productId": "…", "productName": "Hamburguesa especial", "unitPrice": 18000, "quantity": 1, "subtotal": 18000 }]
  },
  "whatsapp": { "url": "https://wa.me/573001234567?text=…", "message": "¡Hola! Quiero realizar el siguiente pedido:…" } // o null si el negocio no tiene WhatsApp
}
```

Mensaje (formato de la sección 9, con el número de pedido, el nombre y los datos opcionales que existan):

```
¡Hola! Quiero realizar el siguiente pedido:

Negocio: Sabores del Caribe
Pedido: #12
Nombre: Luis Gómez

PRODUCTOS
1. Hamburguesa especial x1 - $18.000
2. Bebida x2 - $8.000
3. Salchipapa x1 - $15.000

Entrega: Domicilio
Dirección: Calle 20 #15-30
Referencias: Casa azul
Pago: Efectivo
Notas: Sin cebolla

Subtotal: $41.000
Domicilio: $4.000
TOTAL: $45.000

¡Quedo atento a la confirmación!
```

### `GET /store/:slug/orders/:id` — seguimiento del pedido

Lo usa la pantalla de seguimiento del cliente (cada 8–20 s). Requiere la cabecera `X-Order-Key` con la clave secreta con la que se creó el pedido (`idempotencyKey`, que solo conoce el navegador del cliente); con otra clave, otro negocio o un pedido inexistente → 404 `ORDER_NOT_FOUND`. `Cache-Control: no-store`. Límite: 200 consultas cada 10 minutos por IP.

```json
{
  "id": "…", "number": 129, "status": "PREPARING", "deliveryType": "DELIVERY",
  "subtotal": 40000, "deliveryFee": 4000, "discount": 0, "total": 44000, "cancelReason": null,
  "createdAt": "…", "updatedAt": "…",
  "items": [{ "name": "Salchipapa especial", "quantity": 1, "subtotal": 22000 }],
  "history": [{ "status": "PENDING", "at": "…" }, { "status": "PREPARING", "at": "…" }],
  "business": { "name": "Sabores del Caribe", "phone": "573001234567", "whatsappPhone": "573001234567" }
}
```

No incluye datos personales del cliente (nombre, celular, dirección ni notas).

### `POST /store/:slug/orders/:id/whatsapp`

Opcional (la tienda ya no lo usa: los pedidos llegan directo al panel). Cuerpo `{ "idempotencyKey": "…" }` (la misma del pedido). Registra `whatsappOpenedAt` la primera vez → 204; con otra clave → 404. No cambia el estado.

## Pedidos en el panel — `/orders`

Sesión + miembro del negocio activo (propietario y empleados atienden pedidos).

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/orders?view=active` | — | Pedidos en curso (PENDING a OUT_FOR_DELIVERY), del más antiguo al más reciente |
| GET | `/orders?view=history&page&pageSize&search&from&to` | `search`: nombre, celular o `#número`; fechas `AAAA-MM-DD` en hora de Colombia | Entregados y cancelados, paginado |
| GET | `/orders/:id` | — | Pedido + `statusHistory` (con quién lo cambió), `cancelReason`, `paidAt`, `nextStatuses` |
| PATCH | `/orders/:id/status` | `status`, `from?` (estado que se tenía en pantalla), `reason?` (al cancelar) | Pedido actualizado |
| PATCH | `/orders/:id/payment` | `paid: boolean` | Pedido actualizado (`paidAt`) |

Cambios de estado permitidos (sección 7):

```
PENDING → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED     («Aceptar y preparar» en un toque)
PENDING → CONFIRMED → PREPARING                                (confirmar primero y preparar después)
            └────────→ READY (saltar "en preparación")
READY → DELIVERED (recoger)    ·    OUT_FOR_DELIVERY solo para domicilios
Cualquier estado no final → CANCELLED (con motivo opcional)
```

- Un cambio no permitido → 400 `INVALID_TRANSITION`. Si `from` no coincide con el estado actual (otra persona lo cambió) → 409 `STATUS_CHANGED`.
- Un pedido cancelado no se puede marcar como pagado (`ORDER_CANCELLED`).

## Clientes — `/customers`

Solo el propietario (datos personales y compras).

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/customers?search&page&pageSize` | `{ items: [{ id, name, phone, orders, spent, lastOrderAt }], total, … }` ordenado por último pedido |
| GET | `/customers/:id` | Cliente, `addresses`, últimos 50 `orders` y `stats` (`orders`, `cancelled`, `spent`, `lastOrderAt`) |

`spent` suma los pedidos aceptados (confirmados en adelante, sin cancelados).

## Analíticas — `/analytics`

| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| GET | `/analytics/today` | miembro | Resumen del día: `sales`, `salesOrders`, `averageTicket`, `created`, `pending`, `cancelled`, `topProducts` (3) |
| GET | `/analytics/summary?from&to` | OWNER | Periodo (máx. 1 año; sin fechas = hoy) |

Definiciones (sección 11): **ventas** = suma del total de los pedidos que cumplen la política del negocio (`business_settings.sales_policy`: `ACCEPTED` confirmados en adelante · `DELIVERED` entregados · `PAID` marcados como pagados); un cancelado nunca cuenta. **Pedidos** = registrados en el periodo. **Ticket promedio** = ventas ÷ pedidos incluidos en las ventas (redondeado al peso). **Producto más vendido** = más unidades en los pedidos que cuentan como venta. Los días se cuentan en la zona horaria del negocio.

`summary` devuelve `range`, `salesPolicy`, `sales`, `salesOrders`, `averageTicket`, `orders { created, pending, accepted, delivered, cancelled, paid }`, `delivery { delivery, pickup, dineIn }`, `topProduct`, `topProducts` (10), `byDay` (todos los días del periodo), `byHour` (24 horas) y `previous` (periodo anterior de igual duración).

## Tiempo real — Socket.IO (`/socket.io/`)

Mismo servidor y misma cookie de sesión. Al conectar, el servidor verifica la sesión y la membresía en el negocio activo y une el socket a la sala `business:<id>`; rechaza otros orígenes y vuelve a validar cada minuto.

| Evento (servidor → panel) | Datos |
|---|---|
| `ready` | `{ businessId }` |
| `order:created` | `{ orderId, number, total, customerName, deliveryType, createdAt }` |
| `order:updated` | `{ orderId, number, status, paidAt, changedBy }` |
| `business:changed` | `{ scope, clientId }`: `scope` = `catalog` (productos y categorías), `business` (datos y configuración de la tienda, equipo, cuentas de pago) o `subscription` (plan: pago aprobado en Wompi o cambio desde /admin) |

Los eventos solo avisan: el panel vuelve a consultar la API (también al reconectarse). `business:changed` se envía tras cada `POST`/`PUT`/`PATCH`/`DELETE` exitoso a `/products`, `/categories`, `/businesses` y `/businesses/current/payment-accounts`; el panel envía en cada petición la cabecera `X-Pedify-Client` (un id por pestaña) y el evento la repite en `clientId`, para que la pestaña que hizo el cambio no se recargue a sí misma.

## Suscripción — `/subscription`

`GET /subscription` (OWNER) → plan, `priceMonthly`, `priceYearly` (12 meses con el descuento ya aplicado), `annualDiscountPercent`, estado (`TRIAL`, `ACTIVE`, `PAST_DUE`, `EXPIRED`), `endsAt`, `daysLeft`, `graceEndsAt`, `usage { products, members }`, `limits` (`null` = ilimitado, como en el plan Empresa), catálogo `plans`, `payments`, `onlinePayment` (`{ provider: "WOMPI", sandbox }` con las llaves de Wompi, si no `null`) y `support { whatsapp, url }` (si `SUPPORT_WHATSAPP` está configurado).

Pago en línea con Wompi (OWNER):

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/subscription/checkouts` | `plan` (EMPRENDEDOR, NEGOCIO, EMPRESA), `months` (1 o 12; 12 = precio anual con descuento) | 201 `{ id, amount, url }`: `url` es el Web Checkout de Wompi con el valor firmado (firma de integridad) y regreso a `/panel/plan?pago=<id>` |
| POST | `/subscription/checkouts/:id/confirm` | `transactionId?` (el `id` que Wompi agrega al regresar) | `{ id, status, plan, planName, months, amount, paymentMethod }`; consulta la transacción en Wompi con la llave privada y, si está aprobada, extiende el plan |

- `status`: `PENDING`, `APPROVED`, `DECLINED`, `VOIDED`, `ERROR` (los de Wompi). Aprobado, el plan se extiende como un pago registrado (desde la fecha más tardía entre hoy, lo ya pagado y el fin de la prueba) con `method: "WOMPI"`, `reference` = transacción y `note` = medio (Tarjeta, Nequi, PSE…). Se aplica una sola vez aunque el aviso y la confirmación lleguen juntos o repetidos.
- 409 `ONLINE_PAYMENT_UNAVAILABLE` sin las llaves de Wompi; 409 `PLAN_TOO_SMALL` si el menú o el equipo no caben en el plan elegido; 404 `CHECKOUT_NOT_FOUND` para cobros de otro negocio.

`POST /webhooks/wompi` (sin sesión): avisos de Wompi (`transaction.updated`). Se verifica `signature.checksum` (SHA-256 de las `signature.properties`, el `timestamp` y `WOMPI_EVENTS_SECRET`): 401 `INVALID_SIGNATURE` si no coincide. Las transacciones con otra referencia (otros cobros de la cuenta de Wompi) o con un valor distinto al del cobro se ignoran. Responde 200 para que Wompi no reintente.

Límites del plan: crear o restaurar productos y agregar personas al equipo responde 409 `PLAN_LIMIT` al llegar al tope. Con la suscripción vencida (después de 5 días de gracia), `POST /store/:slug/orders` responde 409 `STORE_UNAVAILABLE` y la tienda informa `status.onlineOrdering: false`.

## Panel central — `/admin`

Sesión de un usuario con `is_platform_admin` (403 `ADMIN_REQUIRED` si no).

| Método | Ruta | Cuerpo / consulta | Respuesta |
|---|---|---|---|
| GET | `/admin/metrics` | — | `businesses` (total, trial, active, pastDue, expired, suspended, new7, new30…), `orders` (orders1, orders30, gmv30, storesWithOrders7), `mrr`, `plans`, `system` (version, uptime, memoria, latencia de la base) |
| GET | `/admin/businesses?search&status&page&pageSize` | `status`: TRIAL, ACTIVE, PAST_DUE, EXPIRED, SUSPENDED | Negocios con propietario, plan, estado, productos, pedidos de 30 días |
| GET | `/admin/businesses/:id` | — | Detalle, equipo, conteos, suscripción y pagos |
| PATCH | `/admin/businesses/:id` | `status?` (ACTIVE/SUSPENDED), `plan?`, `extendTrialDays?` (1–90) | Detalle |
| POST | `/admin/businesses/:id/payments` | `months` (1–12), `method` (NEQUI, DAVIPLATA, TRANSFERENCIA, EFECTIVO, OTRO), `plan?`, `amount?` (por defecto precio mensual × meses; con 12 meses, el precio anual con descuento), `reference?`, `note?` | 201 detalle con el periodo extendido |

## Clientes: supresión de datos

`DELETE /customers/:id` (OWNER) → 204. Anonimiza al cliente y la copia de sus datos en los pedidos (nombre, celular, direcciones, referencias y notas); los valores de los pedidos se conservan.

## Monitoreo

- `POST /client-errors` (público) → 204. Los errores de JavaScript de los navegadores: `{ message, source?, line?, column?, stack?, page? }` (solo la ruta de la página, sin `?` ni `#`). Lo envía `public/js/error-report.js`, un script clásico que todas las páginas cargan antes que sus módulos (atrapa también errores de sintaxis en navegadores antiguos; máximo 5 por página). Solo se registra en el log con el navegador (`user-agent`). Límite: 30 cada 10 minutos por IP.

- `GET /health` → `{ status: "ok", version, uptimeSeconds, database: { status, latencyMs } }`; 503 con `status: "error"` si la base no responde.
- Toda respuesta lleva `X-Request-Id`. Los errores 500 incluyen `error.requestId`.
- `GET /metrics` (fuera de `/api`) con `Authorization: Bearer <METRICS_TOKEN>`: formato Prometheus. Sin `METRICS_TOKEN`, la ruta no existe.

## Páginas

| Ruta | Archivo |
|---|---|
| `/` | `public/index.html` |
| `/login` | `public/pages/auth/login.html` |
| `/registro` | `public/pages/auth/register.html` |
| `/panel` | `public/pages/dashboard/index.html` (sin cookie → `/login?next=…`) |
| `/panel/pedidos` | `public/pages/dashboard/orders.html` (`?pedido=<id>` abre el detalle) |
| `/panel/menu` | `public/pages/dashboard/products.html` |
| `/panel/clientes` | `public/pages/dashboard/customers.html` |
| `/panel/analiticas` | `public/pages/dashboard/analytics.html` |
| `/panel/tienda` | `public/pages/dashboard/store.html` |
| `/panel/configuracion` | `public/pages/dashboard/settings.html` |
| `/panel/plan` | `public/pages/dashboard/plan.html` |
| `/admin` | `public/pages/admin/index.html` (panel central de Pedify) |
| `/recuperar` · `/restablecer` | `public/pages/auth/forgot.html` · `reset.html` |
| `/privacidad` | `public/pages/legal/privacy.html` |
| `/tienda/:slug` | `public/pages/store/index.html` con las etiquetas Open Graph del negocio (404 si no existe; mayúsculas → redirección 301) |
| `/uploads/…` | Imágenes con `STORAGE_DRIVER=local` |
