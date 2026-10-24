# Pedify

Plataforma SaaS para que restaurantes, salchipaperías, pizzerías, reposterías y otros negocios de comida administren su menú, reciban pedidos ordenados por WhatsApp y consulten sus ventas desde un panel.

Arquitectura: **monolito modular** con Node.js + Express + TypeScript, PostgreSQL + Prisma, HTML + JavaScript + Tailwind CSS (compilado), Socket.IO, Zod, Vitest + Supertest y Docker. Ver [`docs/architecture.md`](docs/architecture.md).

El nombre comercial es **Pedify** (antes PedifyAI). Los identificadores técnicos siguen en minúscula como `pedifyai` (carpeta, paquete, base de datos, imágenes de Docker y cookie) para no romper sesiones ni despliegues.

## Estado por fases

| Fase | Trabajo | Estado |
|---|---|---|
| 1. Fundamentos | Backend, base de datos, autenticación y negocios | ✅ Lista |
| 2. Catálogo | Productos, categorías, fotos y tienda pública | ✅ Lista |
| 3. Pedidos | Carrito, direcciones, costos y WhatsApp | ✅ Lista |
| 4. Operación | Panel en vivo, estados, notificaciones y analíticas | ✅ Lista |
| 5. Comercialización | Suscripciones, monitoreo, copias y mejoras | ✅ Lista |
| Puesta en producción | Despliegue con HTTPS, entorno de pruebas, verificación y piloto (secciones 13, 15 y 16) | ✅ Lista para un servidor |

### Incluido en la fase 1

- Esquema completo de la base de datos (las 11 tablas del documento de arquitectura) con claves foráneas compuestas para aislar negocios y restricciones `CHECK` para el dinero.
- Registro de comerciante + negocio en un paso, inicio y cierre de sesión, cierre en todos los dispositivos, cambio de contraseña.
- Sesiones seguras en cookie `httpOnly` (token aleatorio, en la base solo su hash SHA-256), con renovación y revocación.
- Multiempresa: el acceso al negocio se verifica en la base de datos en **cada** petición.
- Negocios: datos, enlace público (slug único), configuración (horario semanal, WhatsApp, domicilio, pedido mínimo, métodos de pago), equipo con roles propietario/empleado, varios negocios por cuenta.
- Seguridad: Helmet (CSP estricta), CORS, protección CSRF por origen, límites de solicitudes, Argon2id, validación con Zod, errores sin datos sensibles.
- Interfaz: portada, inicio de sesión, registro, panel (inicio + configuración) adaptable a celular y escritorio.
- 47 pruebas (Vitest + Supertest) contra un PostgreSQL real.

### Incluido en la fase 2

- **Menú digital** (`/panel/menu`): crear, editar, ocultar, marcar agotados, ordenar y eliminar productos; categorías (crear, renombrar, ordenar, eliminar). Un producto que ya aparece en pedidos se **archiva** en lugar de borrarse y se puede restaurar.
- **Fotos** en almacenamiento compatible con S3 (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO) o en disco en desarrollo. El servidor vuelve a procesar cada imagen: corrige la orientación, la reduce, la convierte a WebP y le quita los metadatos (incluida la ubicación GPS de las fotos del celular). En el celular, las fotos grandes se reducen antes de subirlas para gastar menos datos.
- **Mi tienda** (`/panel/tienda`): logo, portada, vista previa en vivo, enlace para copiar o enviar por WhatsApp y **código QR** descargable para imprimir.
- **Tienda pública** (`/tienda/<slug>`): logo, portada, horario y estado de atención calculados en hora de Colombia (incluye turnos que pasan la medianoche), domicilio, métodos de pago, categorías con navegación fija y productos con foto, descripción, precio en COP e indicador de agotado. Al compartir el enlace por WhatsApp o Facebook se ve el nombre, la descripción y la portada del negocio.
- Permisos: el propietario edita el menú; un empleado puede marcar productos como agotados o disponibles.
- 70 pruebas en total (23 nuevas: productos, categorías, fotos, tienda pública, horario, aislamiento entre negocios).

### Incluido en la fase 3

- **Carrito** en la tienda pública: agregar y quitar unidades, carrito flotante, resumen con subtotal, domicilio y total. Se conserva en el celular si el cliente recarga la página.
- **Datos de entrega**: nombre, celular, domicilio o recoger en el local, dirección y referencias, método de pago y notas. El navegador recuerda los datos del cliente para su próximo pedido.
- **Cálculo en el backend** (`services/pricing.service.ts`): el servidor toma los precios actuales, verifica que cada producto exista, sea del negocio, esté visible y no esté agotado; el domicilio solo se cobra a domicilio; se respeta el pedido mínimo. Los valores que envíe el navegador se descartan.
- **Solicitud PENDING + WhatsApp** (secciones 9 y 10): el pedido se guarda en una transacción (detalle con copia de nombre y precio, historial de estados, cliente y dirección) con número consecutivo por negocio, y se genera el mensaje con el formato del documento y el enlace `wa.me`. La pantalla de confirmación muestra el número de pedido y deja claro que el cliente **aún debe enviar** el mensaje; se registra cuándo abrió WhatsApp (`whatsapp_opened_at`), distinto de "pedido aceptado".
- **Idempotencia**: un reintento (conexión inestable, doble toque) devuelve el mismo pedido en lugar de duplicarlo.
- No se reciben pedidos si el negocio está cerrado según su horario, en pausa o sin WhatsApp configurado; la tienda lo indica y oculta los botones de agregar.
- Capa de WhatsApp preparada para la API oficial (`modules/whatsapp`) y evento interno de "nuevo pedido" (`services/notification.service.ts`) que la fase 4 conectará con Socket.IO.
- 84 pruebas en total (14 nuevas en `tests/orders.test.ts`).

### Incluido en la fase 4

- **Pedidos en vivo** (`/panel/pedidos`): columnas Nuevos · En cocina · Listos y en camino con tarjetas tipo comanda y la acción siguiente a un toque (Confirmar → Preparar → Listo → Enviar/Entregado). Detalle con datos del cliente (llamar, escribirle por WhatsApp, ver la dirección en el mapa), productos, pago, notas, historial de estados y cancelación con motivo. Historial de entregados y cancelados con búsqueda por nombre, celular o número.
- **Socket.IO** (sección 7): autentica con la cookie de sesión, verifica la membresía antes de unirse a la sala `business:<id>`, rechaza otros orígenes y revalida la sesión cada minuto. Al reconectarse, el panel vuelve a consultar la API (PostgreSQL es la fuente de verdad).
- **Notificaciones**: sonido de alerta (se activa con un clic, como exigen los navegadores), aviso visual con el número de pedido, aviso del sistema si la pestaña no está a la vista, contador de pendientes en el menú y en el título de la pestaña.
- **Estados** con reglas de transición, historial de quién hizo cada cambio y detección de cambios simultáneos (409 si otra persona ya lo cambió). Pago recibido (`paid_at`) aparte de aceptado y entregado.
- **Clientes** (`/panel/clientes`, solo propietario): búsqueda, compras, direcciones e historial de pedidos.
- **Analíticas** (`/panel/analiticas`, solo propietario; sección 11): ventas, pedidos, ticket promedio y producto más vendido con comparación contra el periodo anterior, ventas por día, horas pico, productos más vendidos y desglose (registrados, aceptados, entregados, pagados, cancelados), en hora de Colombia. La **política de ventas** (aceptados, entregados o pagados) se elige en Configuración; los cancelados nunca cuentan.
- **Inicio**: resumen real del día, pedidos en vivo con su acción siguiente y productos destacados.
- El seed agrega un historial de ejemplo (unas tres semanas de pedidos) a la cuenta demo para ver Analíticas con datos.
- Corrección: la conexión a PostgreSQL usa siempre UTC; antes, con una base configurada en hora de Colombia, las fechas se guardaban 5 horas corridas.
- 104 pruebas en total (20 nuevas: atención de pedidos, analíticas, clientes, zona horaria y Socket.IO).

### Incluido en la fase 5

- **Planes y suscripciones**: Emprendedor ($119.900/mes o $1.294.920/año, 10 % de descuento), Negocio ($399.900/mes o $4.414.896/año, 8 %) y Empresa ($799.900/mes o $9.118.860/año, 5 %), con límites de productos, de personas y de negocios por propietario (1, 3 o ilimitados); 7 días de prueba gratis del plan que se elige al registrarse (por defecto, Negocio); vencido con 5 días de gracia y, después, la tienda deja de recibir pedidos en línea (el panel sigue funcionando). Página **Mi plan** con uso, planes, **pago en línea con Wompi** (tarjeta, PSE, Nequi o botón Bancolombia; el plan se activa solo al aprobarse) o, sin Wompi, por WhatsApp del equipo, y pagos registrados; avisos en el panel cuando la prueba termina o el plan vence. Sección de planes en la portada.
- **Panel central de Pedify** (`/admin`, sección 16): métricas globales (negocios por estado, ingreso mensual estimado, pedidos y ventas de las tiendas, salud del sistema), negocios con búsqueda y filtros, registrar pagos, cambiar de plan, ampliar la prueba y suspender o reactivar. Los administradores se asignan solo por consola (`npm run admin:grant`).
- **Monitoreo**: identificador por petición (`X-Request-Id`) en los registros y código de soporte en los errores 500; `/api/v1/health` con estado de la base (503 si falla); métricas Prometheus en `/metrics` protegidas con `METRICS_TOKEN`.
- **Copias de seguridad**: `npm run db:backup`, `db:backup:verify` (restaura en una base temporal y compara) y `db:restore` (solo en una base vacía); en Docker, servicio `backup` con `pg_dump` diario y prueba de restauración.
- **Recuperación de contraseña** (sección 12): enlace de un solo uso por correo (SMTP), válido 30 minutos, del que solo se guarda el hash; al usarlo se cierran todas las sesiones. La respuesta no revela si el correo tiene cuenta.
- **Datos personales** (Ley 1581): autorización registrada al crear la cuenta, aviso al cliente antes de enviar su pedido, página `/privacidad` (borrador por completar) y supresión de los datos de un cliente desde el panel.
- 123 pruebas en total (19 nuevas). Guía de operación: [`docs/operations.md`](docs/operations.md).

### Incluido en la puesta en producción

- **Stack de servidor** (`docker-compose.yml`): Caddy con **HTTPS automático** (Let's Encrypt) y compresión → app → PostgreSQL sin puertos expuestos; contraseñas obligatorias; registros de Docker con rotación; copias diarias con prueba de restauración y copia **fuera del servidor** (rclone a Cloudflare R2/S3, opcional).
- **Despliegue** (`scripts/deploy.sh`): revisa `.env`, construye, hace una copia antes de migrar, aplica migraciones, arranca, espera la salud, verifica desde afuera y **vuelve sola a la versión anterior** si la nueva no queda sana. `rollback` y `status`. Conserva las últimas 5 versiones.
- **Verificación** (`npm run smoke -- https://dominio`): salud, cabeceras de seguridad, HTTPS y certificado, CSS de producción, rutas protegidas, `robots.txt` y WebSocket a través del proxy. Solo lee.
- **Entorno de pruebas** (`APP_ENV=staging`): franja «Entorno de pruebas» en todas las páginas, «[Pruebas]» en títulos y correos, sin indexar; el seed de demostración solo corre ahí (con `DEMO_PASSWORD`), nunca en producción.
- **Configuración pendiente**: al arrancar en producción se avisa lo que falta (HTTPS, proxy, S3, correo, WhatsApp de soporte, métricas) y el panel central lo muestra.
- **Integración continua** (`.github/workflows/ci.yml`): tipos, pruebas y compilación; luego un despliegue completo con Docker, verificación por HTTPS, copia con restauración, segundo despliegue y reversión.
- Cierre ordenado ante `SIGTERM` y reinicio limpio ante errores no controlados; `robots.txt` para producción.
- 131 pruebas en total (8 nuevas). Guía paso a paso del servidor, el entorno de pruebas y el piloto con un negocio real: [`docs/deployment.md`](docs/deployment.md).

### Rediseño con fotos y «Elegir productos»

- **Fotos de comida** en toda la plataforma (23 fotos de dominio público, WebP de 960 y 480 px; fuentes en `scripts/photos.ts`).
- **Portada** nueva: collage de fotos con la comanda y el mensaje de WhatsApp, cinta animada de comidas, mosaico de tipos de negocio, la tienda en un teléfono y animaciones al bajar (respetan «reducir movimiento»).
- **Tienda pública**: portada grande, carrusel **«Los más pedidos»** (los más vendidos del último mes con foto; `featured` en la API), tarjetas con foto en escritorio y **ficha del producto** con la foto en grande y «Agregar a mi pedido».
- **Panel**: bienvenida sobre la portada del negocio, aviso de productos sin foto e ingreso/registro con fotos.
- **Mi menú → «Elegir productos»** en cada categoría: marca y desmarca productos de toda la carta (con búsqueda, seleccionar todo y quitar selección); los desmarcados pasan a «Sin categoría» (`PUT /api/v1/categories/:id/products`).
- El menú de demostración (`npm run db:seed`) trae fotos y portada.
- 134 pruebas en total.

### Pedidos directos al panel (sin WhatsApp)

- El cliente toca **«Hacer pedido»** y listo: el pedido llega al instante al panel del negocio, con sonido. Ya no tiene que enviar un mensaje de WhatsApp.
- El negocio lo atiende con un toque por paso: **Aceptar y preparar → Pedido listo → Enviar con domiciliario → Marcar entregado** (para recoger: «Entregado al cliente»).
- El cliente ve su **seguimiento en vivo** (Recibido, en preparación, listo, en camino, entregado o cancelado con el motivo), aunque cierre y vuelva a abrir la tienda en ese celular. Ruta `GET /api/v1/store/:slug/orders/:id`, protegida con la clave secreta del pedido.
- El WhatsApp del negocio queda como contacto opcional en la tienda y en el seguimiento.
- 136 pruebas en total.

### Notificaciones push

- Cada persona del equipo activa **avisos en su celular o computador** (tarjeta en Inicio, botón del menú o Configuración → Pedidos): con cada pedido nuevo le llega una notificación aunque tenga el panel cerrado, y al tocarla se abre el pedido. Incluye aviso de prueba.
- Web Push estándar con llaves VAPID (`npm run push:keys`), service worker `/sw.js` y manifiesto para instalar Pedify como app (necesario en iPhone; ver «La app en el celular y en el computador»).
- Al salir del equipo, cerrar sesión o cambiar la contraseña, los dispositivos dejan de recibir avisos.
- 141 pruebas en total.

### Roles al iniciar sesión y permisos por empleado

- En el inicio de sesión se elige **Soy el dueño** o **Soy empleado**; el servidor verifica que la cuenta tenga ese rol (si no, no entra y le dice cuál elegir).
- El dueño puede todo. A cada empleado el dueño le elige, en **Configuración → Equipo**, si puede **marcar agotados**, **ver las ventas del día**, **ver los clientes** y **ver las analíticas** (por defecto, todo menos analíticas). Atender pedidos siempre puede; editar el menú, configurar el negocio, el equipo, el plan y borrar datos de clientes es solo del dueño.
- El panel oculta lo que no puede ver y el servidor lo bloquea igual (403). Los empleados ven en Configuración solo sus avisos y su cuenta.
- Cuenta de ejemplo: `empleado@pedifyai.com` (misma contraseña del demo).
- 149 pruebas en total.

### Mapa en tiempo real del domicilio

- Al pedir, el cliente puede tocar **«Marcar mi ubicación exacta»** (opcional) y ajustar el pin en un mapa.
- Al tocar **«Enviar con domiciliario»**, el panel muestra un **enlace y un código QR** para el domiciliario (se puede enviar por WhatsApp). Él lo abre en su celular sin cuenta: ve la dirección, el celular del cliente, lo que debe cobrar y botones a Google Maps y Waze; toca **«Empezar entrega»** y comparte su ubicación (la pantalla no se apaga mientras tanto).
- El cliente ve en su seguimiento un **mapa con la moto acercándose a su casa** y la distancia («Tu domiciliario está a 950 m»), actualizado cada 5 segundos. Mientras va en camino, la barra de su pedido dice **«Ver en el mapa»**. El negocio también lo ve en el detalle del pedido.
- El domiciliario marca **«Entregado»** desde su celular. Al entregar o cancelar se borran las ubicaciones y el enlace deja de funcionar.
- Mapas con Leaflet y OpenStreetMap (sin llave); el proveedor se cambia con `MAP_TILE_URL`.

### Pago por adelantado con QR (Nequi, Bre-B, Daviplata)

- En **Configuración → Pagos** el dueño sube el QR para recibir pagos que le da su app (un pantallazo sirve) y escribe su número o llave y el titular. Pedify lee el código y lo muestra nítido; si la imagen no tiene un QR legible, lo avisa.
- Cuando el cliente elige **Nequi, Daviplata o transferencia**, en el carrito aparece **«Paga ahora y envía tu pedido»**: el QR, el valor exacto, el número o la llave Bre-B (para copiar) y «Guardar imagen del QR» (para subirla en la app si pide desde el mismo celular). Paga, **sube el pantallazo del comprobante** y solo entonces puede enviar el pedido.
- En el panel, el pedido llega con **«Revisar comprobante»**: el negocio abre la imagen, confirma en su app que llegó el valor y lo marca como **Pagado**. El cliente ve «Comprobante enviado» y luego «Pago confirmado»; el domiciliario ve «Pagó por adelantado: no cobres».
- Los comprobantes son privados (solo los ve el equipo del negocio). Efectivo y datáfono siguen pagándose al recibir; si el negocio solo quiere pedidos pagados, desmarca esos métodos. Para pedidos en efectivo, el domiciliario también puede mostrar el QR al entregar («Mostrar QR para pagar»).
- El QR de la llave Bre-B se paga desde cualquier banco o billetera. Como es el QR fijo del negocio, no trae el valor: el cliente escribe el total que le mostramos. 165 pruebas en total.

### La app en el celular y en el computador

- Pedify se **instala como app** (aplicación web instalable) en Android, iPhone, Windows y Mac, sin tiendas de apps: abre en su propia ventana desde su ícono, con accesos directos a Pedidos, Mi menú e Inicio. Siempre abre la versión más nueva.
- **`/app`** explica cómo instalarla según el equipo (botón de instalar en Chrome y Edge; pasos en iPhone, Mac y Firefox) y, en el computador, trae un código QR para instalarla también en el celular. En el panel: «Instalar la app» en el menú y una tarjeta en Inicio.
- **Todo conectado en vivo**: además de los pedidos, los cambios del menú (agotados, precios, orden), de la tienda (pausar pedidos, logo, portada) y del plan llegan al instante a todos los dispositivos con la misma cuenta. Socket.IO avisa `business:changed` y cada pantalla vuelve a consultar la API; la pestaña que hizo el cambio se reconoce por la cabecera `X-Pedify-Client`. En Configuración, en vez de redibujar lo que estás escribiendo, aparece «Se guardaron cambios desde otro dispositivo · Actualizar».
- **El pago del plan con Wompi** funciona igual en la app del celular y la del computador: al aprobarse, el plan se actualiza en todos los dispositivos abiertos. Si Wompi se abre aparte (iPhone), el cobro en curso se revisa al volver a la app.
- Sin internet, la app muestra una pantalla propia («Se fue el internet») que se recarga sola al volver la conexión.
- 184 pruebas en total.

### Verificación automática del comprobante de pago

- Cuando el cliente paga por Nequi, Daviplata, Bre-B o transferencia y sube el pantallazo, **Pedify lo lee solo** (OCR con Tesseract en español, dentro del servidor: sin servicios externos ni costos) y revisa que sea un **pago exitoso**, por el **valor exacto** del pedido, a **una de las cuentas del negocio** (celular, llave o nombre del titular), **de ese momento** (hoy, hasta 3 horas antes) y **no usado en otro pedido** (el mismo pantallazo o la misma referencia).
- El cliente ve al subirlo «Leímos $40.000: coincide con tu pedido» o un aviso si parece de otro valor. En el panel, cada pedido dice **Comprobante verificado**, **Revisar comprobante** o **Comprobante no coincide**, y el detalle muestra cada revisión; aceptar un pedido cuyo comprobante no coincide pide confirmación. El domiciliario ve «Confirma el pago con el negocio» si no coincide.
- Es una revisión del comprobante: la confirmación definitiva sigue siendo ver el dinero en la cuenta (el panel lo recuerda).

### Domicilio según la distancia

- En **Configuración → Entrega** el negocio elige **Tarifa fija** (como antes) o **Según la distancia**: marca la ubicación de su negocio en el mapa (o con el GPS) y define rangos (hasta 8) y un valor por **cada km adicional** para llegar a **toda la ciudad, sea cual sea** (o solo hasta los km que elija; tope de 50 km). Valores sugeridos (2026): hasta 2 km $4.000 · 4 km $5.500 · 6 km $7.000 · 8 km $8.500 · cada km adicional $1.000. Una vista previa muestra lo que paga un cliente a 1, 3, 5, 8, 12 y 20 km.
- En la tienda, la ficha dice «Domicilio desde $4.000 · toda la ciudad». En el carrito, el cliente comparte su ubicación (GPS o pin en el mapa) y ve al instante «a 3,2 km · domicilio $5.000» y el total; si queda fuera de la zona, se le explica y puede elegir recoger. Al mover el pin, el valor se recalcula.
- El servidor recalcula siempre el domicilio con la ubicación del cliente (línea recta desde el negocio) y guarda la distancia del pedido; en el panel, cada pedido dice «Domicilio · 3,2 km».

## Requisitos

- Node.js 22.12 o superior (probado con Node 24).
- PostgreSQL 16+ **o** nada más: para desarrollo se incluye un PostgreSQL embebido (no necesita Docker).

## Puesta en marcha (desarrollo)

```bash
npm install                # instala dependencias y genera el cliente de Prisma
cp .env.example .env       # variables de entorno locales

npm run db:start           # terminal 1: PostgreSQL local en el puerto 5433 (datos en .pgdata/)
npm run db:deploy          # aplica las migraciones
npm run db:seed            # opcional: comerciante demo con menú (demo@pedifyai.com / pedifyai123)
                           # y un empleado (empleado@pedifyai.com, misma contraseña),
                           # abierto de martes a domingo de 8:00 a. m. a 11:30 p. m.
npm run dev                # terminal 2: API + Tailwind en modo observación → http://localhost:3000
```

Páginas: `/` portada · `/registro` · `/login` · `/recuperar` · `/privacidad` · `/admin` (equipo de Pedify) · `/panel/plan` · `/panel` · `/panel/pedidos` · `/panel/menu` · `/panel/clientes` · `/panel/analiticas` · `/panel/tienda` · `/panel/configuracion` · `/tienda/<slug>` (tienda pública, p. ej. `/tienda/sabores-del-caribe`).

Las fotos se guardan en `uploads/` en desarrollo. En producción se recomienda `STORAGE_DRIVER=s3` (ver `.env.example`).

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga (`tsx watch`) + Tailwind en modo observación |
| `npm run build` | Compila el CSS (minificado) y el TypeScript a `dist/` |
| `npm start` | Ejecuta la versión compilada |
| `npm run smoke -- <url>` | Verifica un despliegue (solo lectura) |
| `npm test` | Pruebas; levanta un PostgreSQL temporal (o usa `TEST_DATABASE_URL`) |
| `npm run typecheck` | Verificación de tipos de todo el proyecto |
| `npm run db:start` | PostgreSQL embebido para desarrollo |
| `npm run db:migrate` | Crea/aplica migraciones en desarrollo (`prisma migrate dev`) |
| `npm run db:deploy` | Aplica migraciones pendientes (producción) |
| `npm run db:seed` | Datos de demostración |
| `npm run db:studio` | Explorador visual de la base (Prisma Studio) |
| `npm run db:backup` | Copia de seguridad en `backups/` |
| `npm run db:backup:verify` | Prueba de restauración de la última copia (base temporal) |
| `npm run db:restore` | Restaura una copia en una base vacía |
| `npm run admin:grant -- correo` | Da acceso al panel central `/admin` |
| `npm run push:keys` | Genera las llaves VAPID de los avisos push |

Los íconos (Lucide) y la fuente (Archivo) se generan en `public/assets` con `npx tsx scripts/build-assets.ts`; las fotos de comida, con `npx tsx scripts/photos.ts`.

## Producción (Docker)

```bash
cp deploy/env.example .env   # en el servidor: dominio, contraseñas, R2, correo…
scripts/deploy.sh            # construye, copia, migra, arranca y verifica
```

Caddy sirve el dominio con HTTPS automático y reenvía el WebSocket del panel en vivo. Paso a paso (servidor, DNS, R2, entorno de pruebas, actualizar, revertir, copias, monitoreo y piloto): [`docs/deployment.md`](docs/deployment.md).

## Estructura

```
prisma/            esquema, migraciones y seed
deploy/            Caddyfile y plantilla del .env del servidor
scripts/           base local, copias, administradores, despliegue y verificación
src/
  config/          entorno, base de datos, CORS, socket (Socket.IO)
  middlewares/     authenticate, authorize, validate, errorHandler, rateLimiter, upload
  modules/         auth, businesses, products (menú, categorías y tienda pública),
                   orders (tienda y panel), customers, analytics, whatsapp, subscriptions, admin
  services/        storage (imágenes), pricing (cálculo del pedido), notification (eventos), mail, metrics
  utils/           dinero (COP), paginación, errores, logger, teléfonos
  types/           tipos compartidos y extensión de Express
public/            HTML, JS y recursos del frontend (Tailwind compilado en css/app.css)
tests/             pruebas de la API
docs/              arquitectura, base de datos y API
```

Documentación: [puesta en producción](docs/deployment.md) · [operación](docs/operations.md) · [arquitectura](docs/architecture.md) · [base de datos](docs/database.md) · [API](docs/api.md) · [sistema visual](DESIGN.md).
