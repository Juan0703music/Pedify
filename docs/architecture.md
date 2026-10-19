# Arquitectura

Pedify sigue el documento *Arquitectura de Software de Pedify*: un **monolito modular** que sirve la API y el frontend desde el mismo proceso Express.

```
Navegador (HTML + JS + Tailwind)
        │  cookie de sesión httpOnly
        ▼
Express ── Helmet · CORS · guardia de origen · límite de solicitudes · JSON (100 kB)
        │
        ▼
Routes → Controllers → Services → Repository (Prisma) → PostgreSQL
```

- **Routes** (`*.routes.ts`): endpoints, autenticación (`authenticate`), autorización (`requireBusiness`) y validación (`validate` + Zod).
- **Controllers** (`*.controller.ts`): traducen HTTP ↔ servicio. Responden `{ data }` o `{ error: { code, message, fields? } }`.
- **Services** (`*.service.ts`): reglas del negocio y transacciones.
- **Repositories** (`*.repository.ts`): únicas piezas que consultan Prisma; seleccionan campos explícitos (nunca devuelven `password_hash`).

## Multiempresa (multi-tenant)

1. La sesión guarda el **negocio activo** (`sessions.active_business_id`).
2. `requireBusiness()` consulta `business_memberships` en **cada petición**: si el usuario ya no pertenece al negocio, o el negocio está suspendido, responde 403. Deja `req.tenant = { businessId, role }`.
3. Los servicios siempre filtran por `req.tenant.businessId`; los ids que llegan en la URL se buscan junto con el negocio (`findFirst({ where: { id, businessId } })`), nunca solos.
4. En la base, claves foráneas compuestas impiden mezclar datos: un pedido solo puede referirse a clientes y productos de **su** negocio (ver [database.md](database.md)).

Roles: `OWNER` (configura el negocio y su equipo) y `EMPLOYEE` (opera; en fases 3–4 atenderá pedidos). Un negocio nunca puede quedarse sin propietario (transacción `Serializable`).

## Autenticación

Se eligió **sesiones en base de datos** en lugar de JWT (el documento permite ambas):

- Token aleatorio de 256 bits en cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción (prefijo `__Host-`).
- En la base solo se guarda el **SHA-256** del token: una filtración de la tabla no permite suplantar sesiones.
- Revocación inmediata: cerrar sesión, cerrar todas, y al cambiar la contraseña se cierran las demás sesiones.
- Renovación deslizante (7 días por defecto) con vida máxima de 30 días.
- Contraseñas con **Argon2id** (parámetros OWASP). Con un correo inexistente se verifica contra un hash de relleno para no revelar qué correos tienen cuenta.

Socket.IO (fase 4) usará la misma cookie para autenticar y unirse a la sala `business:<id>` tras verificar la membresía.

## Seguridad aplicada

| Riesgo | Medida |
|---|---|
| XSS | CSP estricta (`script-src 'self'`, sin scripts en línea); plantillas del frontend que escapan todo valor interpolado |
| CSRF | Cookie `SameSite=Lax` + rechazo de `Origin`/`Sec-Fetch-Site` de otros sitios + cuerpos JSON |
| Fuerza bruta | `express-rate-limit`: inicio de sesión (10 fallos / 15 min), registro (10 / hora), API general (300 / min) |
| Inyección SQL | Solo consultas parametrizadas de Prisma |
| Datos de entrada | Zod en el servidor (y validación nativa en el navegador) |
| Fugas en registros | `pino` con redacción de cookies, contraseñas y tokens |
| Precios manipulados | El total se calcula en el backend (fase 3); el navegador nunca define precios |

## Catálogo y tienda pública (fase 2)

- `modules/products` agrupa el menú (`products.*`, `categories.*`) y la tienda pública (`store.*`): el documento no define un módulo aparte para categorías ni para la tienda, y ambos son el "catálogo".
- Todas las consultas de productos usan la clave única compuesta `(id, business_id)`: un id de otro negocio simplemente no existe para el usuario (404).
- Eliminar un producto que aparece en pedidos lo **archiva** (sección 5 del documento). Si un pedido lo incluye justo en ese instante, la clave foránea `ON DELETE RESTRICT` lo impide y también se archiva.
- El orden se guarda con `position`; el panel envía el orden completo de una categoría y el servidor lo rechaza si el menú cambió entre tanto (409).
- Roles: el propietario edita el menú; el empleado solo puede cambiar `isAvailable` (agotado), que es parte de la operación diaria.
- La tienda (`GET /store/:slug`) expone solo datos públicos y calcula si el negocio está abierto con su horario en `America/Bogota` (`modules/businesses/opening-hours.ts`).
- La página `/tienda/:slug` es HTML estático; el servidor solo inserta el título y las etiquetas Open Graph (escapadas) para que el enlace se vea bien al compartirlo. El slug público no reemplaza al id interno.

## Pedidos (fase 3; directos al panel)

```
Tienda (carrito) → POST /store/:slug/orders → orders.service
   ├─ negocio activo, abierto (horario America/Bogota), sin pausa
   ├─ ¿clave de idempotencia ya usada? → devuelve ese pedido
   └─ transacción:
        productos del negocio (visibles, no archivados, disponibles) → pricing.service
        → pedido mínimo → cliente por celular + dirección → consecutivo (UPDATE last_order_number)
        → order + order_items (copia de nombre y precio) + order_status_history (PENDING)
   → notification.service ("nuevo pedido") → Socket.IO → panel en vivo (con sonido)
Cliente → GET /store/:slug/orders/:id (X-Order-Key) cada pocos segundos → pantalla de seguimiento
```

- **Precios**: `services/pricing.service.ts` usa solo precios de la base; el esquema de entrada ni siquiera acepta valores monetarios. La base vuelve a verificar con `CHECK` que `total = subtotal + domicilio − descuento` y que cada línea cuadre.
- **Aislamiento**: los productos se buscan con `business_id` del negocio de la tienda y las claves foráneas compuestas impiden guardar un producto ajeno aunque el código fallara.
- **Consecutivo**: `businesses.last_order_number` se incrementa con un `UPDATE` dentro de la transacción (bloquea la fila); `(business_id, number)` es único.
- **Idempotencia**: `(business_id, idempotency_key)` es único. Dos peticiones simultáneas con la misma clave: una crea el pedido y la otra recibe ese mismo pedido.
- **Sin WhatsApp** (cambio pedido por el negocio sobre la sección 9 del documento): el pedido se guarda y llega al instante al panel; el cliente no tiene que enviar ningún mensaje. «Aceptar y preparar» lo pasa de `PENDING` a `PREPARING`; luego «Pedido listo» (`READY`), «Enviar con domiciliario» (`OUT_FOR_DELIVERY`) y «Marcar entregado» (`DELIVERED`).
- **Seguimiento del cliente**: el navegador guarda el id y la clave secreta del pedido (`idempotency_key`, 128 bits aleatorios) y consulta su estado; el servidor compara la clave en tiempo constante y no devuelve datos personales. El WhatsApp del negocio queda como contacto opcional.
- **Capa de WhatsApp** (sección 10): `WhatsAppChannel` con `sendOrderMessage`, `processIncomingMessage`, `verifyWebhook` y `handleDeliveryStatus`. Sigue disponible (la API devuelve el mensaje armado si el negocio tiene WhatsApp) para una futura copia por WhatsApp o la API oficial.
- **Notificaciones**: `notification.service` publica el evento `order.created`; la fase 4 lo enviará por Socket.IO a la sala `business:<id>`.
- **Horario**: `utils/clock.ts` centraliza la hora actual para que las pruebas puedan fijarla.

## Operación en vivo y analíticas (fase 4)

```
orders.service (pedido creado / estado / pago) → notification.service ─┐
                                                                      ▼
                                  config/socket.ts (Socket.IO) → sala business:<id>
                                                                      ▼
                     Panel (notifications.js): sonido · aviso · contador → vuelve a pedir /api/v1/orders
```

- **Autenticación del socket**: cookie de sesión → `authService.resolveSession` → membresía en el negocio activo (misma regla que `requireBusiness`). Se rechazan orígenes no permitidos (`allowRequest`), y cada minuto se revalida: si la sesión se cerró, quitaron a la persona del equipo o cambió de negocio, se desconecta.
- **Fuente de verdad**: los eventos no traen el estado completo; el panel consulta la API al recibir un evento, al reconectarse y al volver a la pestaña.
- **Estados** (`modules/orders/order-status.ts`): transiciones permitidas y etiquetas. El cambio usa `UPDATE … WHERE status = <anterior>` dentro de una transacción con su registro en el historial; si otra persona lo cambió primero, responde 409.
- **Roles**: propietario y empleados atienden pedidos; clientes y analíticas completas son solo del propietario (datos personales y cifras del negocio). El resumen del día del Inicio lo ve todo el equipo.
- **Analíticas** (`modules/analytics`): SQL directo en PostgreSQL (sección 11) con filtros por la política de ventas del negocio y `AT TIME ZONE` para días y horas de Colombia. Fechas de calendario → instantes con `utils/dates.ts`.
- **Interfaz de analíticas**: una serie por gráfica, color de marca validado (mostaza oscuro `#b07d00`: contraste ≥ 3:1, croma y luminosidad), columnas finas, cuadrícula tenue, información al pasar el cursor o con el teclado y vista de tabla equivalente.

## Comercialización (fase 5)

- **Suscripciones** (`modules/subscriptions`): planes en código (`plans.ts`), estado calculado con fechas (`subscription-state.ts`: pagada → prueba → gracia → vencida), límites verificados dentro de las mismas transacciones que crean productos o miembros, y bloqueo de pedidos en línea cuando vence (la tienda se sigue viendo).
- **Panel central** (`modules/admin`): `requirePlatformAdmin` consulta `users.is_platform_admin` en cada petición; el estado de cada suscripción se calcula también en SQL con las mismas reglas. Los cambios (pagos, suspensiones, planes) se registran en el log con el administrador que los hizo.
- **Recuperación de contraseña**: token de 256 bits, solo se guarda su SHA-256, un solo uso (marcado con `UPDATE … WHERE used_at IS NULL`), 30 minutos, invalida los enlaces anteriores y revoca todas las sesiones. El correo sale sin esperar la respuesta para que el tiempo no revele si la cuenta existe.
- **Monitoreo**: `middlewares/requestContext.ts` (identificador, registro y métricas por ruta), `services/metrics.service.ts` (Prometheus sin dependencias), salud con latencia de la base.
- **Copias**: `scripts/backup.ts` (COPY + manifiesto + verificación) y `scripts/docker-backup.sh` (pg_dump diario con prueba de restauración). Ver [operations.md](operations.md).

## Despliegue (secciones 13 y 15)

- Un servidor por entorno (producción y pruebas) con `docker-compose.yml`: **Caddy** (HTTPS automático, compresión, WebSocket) → **app** (imagen `runtime`: solo `dist/`, `public/` y dependencias de producción, usuario sin privilegios, `HEALTHCHECK`) → **PostgreSQL** sin puertos expuestos. La imagen `tools` (migraciones, consola de administración, seed y verificación) corre las migraciones antes de cada arranque.
- `scripts/deploy.sh` encadena copia → migraciones → arranque → salud → verificación externa (`scripts/smoke.ts`), y revierte la imagen si la versión nueva no queda sana. Las migraciones no se revierten: deben ser compatibles con la versión anterior.
- `APP_ENV=staging` marca el entorno de pruebas en el servidor (franja en las páginas, «[Pruebas]» en títulos y correos, `noindex`), sin cambiar el comportamiento de la aplicación. `src/utils/pages.ts` sirve las páginas HTML y aplica la marca.
- `src/config/readiness.ts` lista la configuración de producción que falta; se registra al arrancar y se muestra en `/admin`.
- La integración continua levanta el stack completo con `DOMAIN=localhost` y prueba el despliegue, HTTPS, la copia con restauración y la reversión.

## Imágenes

`services/storage.service.ts` define un `StorageDriver` con dos implementaciones:

| `STORAGE_DRIVER` | Dónde | Uso |
|---|---|---|
| `local` | `UPLOADS_DIR` servido en `/uploads` | Desarrollo o un solo servidor con volumen |
| `s3` | Cualquier servicio compatible con S3 (`S3_*`) | Producción (sección 13: almacenamiento externo) |

Flujo: el navegador envía la imagen como cuerpo binario (máx. 8 MB; en el celular las fotos JPEG se reducen antes) → `middlewares/upload.ts` → `sharp` la decodifica (rechaza lo que no sea imagen y las "bombas" de más de 50 MP), corrige la orientación, la reduce, la convierte a WebP y **elimina los metadatos** (GPS) → se guarda con un nombre aleatorio → se actualiza la fila → se borra la versión anterior. Si falla la base de datos, se borra la imagen nueva. Con S3, el origen público se agrega a la CSP (`img-src`).

## Dinero

Enteros en **pesos colombianos (COP)**, sin centavos (`src/utils/currency.ts`). Cualquier fracción (porcentajes) se redondea al peso más cercano con mitades hacia arriba. La base refuerza con `CHECK` que los valores no sean negativos y que `total = subtotal + domicilio − descuento`.

## Frontend

HTML estático por página + módulos ES (`public/js`) sin framework ni empaquetador. Tailwind CSS v4 se compila a `public/css/app.css` (`src/styles/app.css` es la fuente). El shell del panel (`dashboard.js`) se dibuja con JavaScript para no duplicar la navegación en cada página; cada página importa `initPanel()`.

## Desarrollo sin Docker

`scripts/dev-db.ts` levanta un PostgreSQL real (paquete `embedded-postgres`) y las pruebas crean uno temporal por ejecución. En CI o con Docker basta definir `TEST_DATABASE_URL`.

## Agregados respecto a la estructura del documento

La estructura de carpetas del documento se respeta. Se agregaron, por necesidad técnica:

- `prisma.config.ts` (obligatorio en Prisma 7), `tsconfig.build.json` (compilación sin pruebas), `vitest.config.ts`, `.dockerignore`.
- `scripts/` (PostgreSQL local y generación de íconos/fuente).
- `src/utils/phone.ts` (teléfonos colombianos, formato de wa.me) y `src/styles/app.css` (fuente de Tailwind).
- `src/middlewares/requestContext.ts`, `src/services/{mail,metrics}.service.ts`, `src/utils/html.ts`, `src/modules/{subscriptions,admin}/`, `scripts/{admin,backup}.ts`, `scripts/docker-backup.sh`, `docs/operations.md`, páginas `/panel/plan`, `/admin`, `/recuperar`, `/restablecer` y `/privacidad`.
- `src/utils/clock.ts` (hora actual reemplazable en pruebas), `src/utils/dates.ts` (fechas en hora de Colombia), `src/modules/orders/order-status.ts`, `src/modules/orders/orders.routes.ts` monta los pedidos públicos en `/store/:slug/orders`.
- `src/middlewares/upload.ts` (cuerpo binario de imágenes), `src/modules/businesses/opening-hours.ts` (estado abierto/cerrado), `src/modules/products/{categories,store}.*`.
- `public/js/ui.js` (utilidades de interfaz), `public/js/settings.js` (configuración), `public/js/my-store.js` + `pages/dashboard/store.html` (Mi tienda: sección 6 del documento), `public/js/store.js` (tienda pública), `public/js/cart.js` (carrito y pedido), `public/js/order-ui.js` (piezas de pedidos compartidas), `public/js/customers.js`, `public/404.html`, `public/assets/fonts/`.
- `tests/helpers/`, `tests/businesses.test.ts`, `tests/store.test.ts`, `tests/socket.test.ts` y `tests/utils.test.ts` (clientes se prueban en `tests/analytics.test.ts`).
- Tabla `sessions` (necesaria para revocar sesiones, sección 12 del documento).
