# PedifyAI

Plataforma SaaS para que restaurantes, salchipaperías, pizzerías, reposterías y otros negocios de comida administren su menú, reciban pedidos ordenados por WhatsApp y consulten sus ventas desde un panel.

Arquitectura: **monolito modular** con Node.js + Express + TypeScript, PostgreSQL + Prisma, HTML + JavaScript + Tailwind CSS (compilado), Socket.IO, Zod, Vitest + Supertest y Docker. Ver [`docs/architecture.md`](docs/architecture.md).

## Estado por fases

| Fase | Trabajo | Estado |
|---|---|---|
| 1. Fundamentos | Backend, base de datos, autenticación y negocios | ✅ Lista |
| 2. Catálogo | Productos, categorías, fotos y tienda pública | ✅ Lista |
| 3. Pedidos | Carrito, direcciones, costos y WhatsApp | ✅ Lista |
| 4. Operación | Panel en vivo, estados, notificaciones y analíticas | ✅ Lista |
| 5. Comercialización | Suscripciones, monitoreo, copias y mejoras | ✅ Lista |

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

- **Planes y suscripciones**: Emprendedor ($39.900/mes) y Negocio ($69.900/mes) con límites de productos y de personas; 14 días de prueba al registrarse; vencido con 5 días de gracia y, después, la tienda deja de recibir pedidos en línea (el panel sigue funcionando). Página **Mi plan** con uso, planes, cómo pagar (WhatsApp del equipo) y pagos registrados; avisos en el panel cuando la prueba termina o el plan vence. Sección de planes en la portada.
- **Panel central de PedifyAI** (`/admin`, sección 16): métricas globales (negocios por estado, ingreso mensual estimado, pedidos y ventas de las tiendas, salud del sistema), negocios con búsqueda y filtros, registrar pagos, cambiar de plan, ampliar la prueba y suspender o reactivar. Los administradores se asignan solo por consola (`npm run admin:grant`).
- **Monitoreo**: identificador por petición (`X-Request-Id`) en los registros y código de soporte en los errores 500; `/api/v1/health` con estado de la base (503 si falla); métricas Prometheus en `/metrics` protegidas con `METRICS_TOKEN`.
- **Copias de seguridad**: `npm run db:backup`, `db:backup:verify` (restaura en una base temporal y compara) y `db:restore` (solo en una base vacía); en Docker, servicio `backup` con `pg_dump` diario y prueba de restauración.
- **Recuperación de contraseña** (sección 12): enlace de un solo uso por correo (SMTP), válido 30 minutos, del que solo se guarda el hash; al usarlo se cierran todas las sesiones. La respuesta no revela si el correo tiene cuenta.
- **Datos personales** (Ley 1581): autorización registrada al crear la cuenta, aviso al cliente antes de enviar su pedido, página `/privacidad` (borrador por completar) y supresión de los datos de un cliente desde el panel.
- 123 pruebas en total (19 nuevas). Guía de operación: [`docs/operations.md`](docs/operations.md).

## Requisitos

- Node.js 22.12 o superior (probado con Node 24).
- PostgreSQL 16+ **o** nada más: para desarrollo se incluye un PostgreSQL embebido (no necesita Docker).

## Puesta en marcha (desarrollo)

```bash
npm install                # instala dependencias y genera el cliente de Prisma
cp .env.example .env       # variables de entorno locales

npm run db:start           # terminal 1: PostgreSQL local en el puerto 5433 (datos en .pgdata/)
npm run db:deploy          # aplica las migraciones
npm run db:seed            # opcional: comerciante demo con menú (demo@pedifyai.com / pedifyai123),
                           # abierto de martes a domingo de 8:00 a. m. a 11:30 p. m.
npm run dev                # terminal 2: API + Tailwind en modo observación → http://localhost:3000
```

Páginas: `/` portada · `/registro` · `/login` · `/recuperar` · `/privacidad` · `/admin` (equipo de PedifyAI) · `/panel/plan` · `/panel` · `/panel/pedidos` · `/panel/menu` · `/panel/clientes` · `/panel/analiticas` · `/panel/tienda` · `/panel/configuracion` · `/tienda/<slug>` (tienda pública, p. ej. `/tienda/sabores-del-caribe`).

Las fotos se guardan en `uploads/` en desarrollo. En producción se recomienda `STORAGE_DRIVER=s3` (ver `.env.example`).

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga (`tsx watch`) + Tailwind en modo observación |
| `npm run build` | Compila el CSS (minificado) y el TypeScript a `dist/` |
| `npm start` | Ejecuta la versión compilada |
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

Los íconos (Lucide) y la fuente (Archivo) se generan en `public/assets` con `npx tsx scripts/build-assets.ts`.

## Docker

```bash
docker compose up --build
```

Levanta PostgreSQL, aplica las migraciones (servicio `migrate`) y arranca la aplicación en `http://localhost:3000`. En un servidor con HTTPS define `APP_URL`, `COOKIE_SECURE=true` y `TRUST_PROXY=1`. Las fotos quedan en el volumen `uploads`; para guardarlas en S3 define `STORAGE_DRIVER=s3` y las variables `S3_*`. Detrás de Nginx u otro proxy, habilita WebSocket en `/socket.io/` (cabeceras `Upgrade` y `Connection`) para los pedidos en vivo.

## Estructura

```
prisma/            esquema, migraciones y seed
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

Documentación: [operación](docs/operations.md) · [arquitectura](docs/architecture.md) · [base de datos](docs/database.md) · [API](docs/api.md) · [sistema visual](DESIGN.md).
