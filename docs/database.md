# Base de datos

PostgreSQL con Prisma 7 (`prisma/schema.prisma`). Identificadores UUID v7, fechas `timestamptz`, columnas en `snake_case`. Migraciones en `prisma/migrations/`.

## Tablas

| Tabla | Propósito | Campos principales |
|---|---|---|
| `users` | Cuentas de acceso | id, name, email (único, en minúsculas), password_hash, is_platform_admin, privacy_accepted_at |
| `sessions` | Sesiones del panel | user_id, token_hash (único), active_business_id, expires_at, revoked_at |
| `businesses` | Negocios registrados | id, name, slug (único), phone, status, description, city, address, logo_url/logo_key, banner_url/banner_key, last_order_number |
| `business_memberships` | Usuarios ↔ negocios | user_id, business_id (únicos juntos), role (`OWNER`/`EMPLOYEE`) |
| `business_settings` | Configuración | business_id, opening_hours (JSON), timezone, accepting_orders, whatsapp_phone, delivery_enabled, delivery_fee, delivery_area, pickup_enabled, minimum_order, payment_methods |
| `categories` | Categorías del menú | business_id, name (único por negocio), position |
| `products` | Productos | business_id, category_id, name, description, price, image_url/image_key, is_active, is_available, position, archived_at |
| `customers` | Clientes | business_id, name, phone (único por negocio) |
| `customer_addresses` | Direcciones | customer_id, address, references |
| `orders` | Pedidos | business_id, customer_id, number (consecutivo por negocio), status, delivery_type, copia de datos del cliente, subtotal, delivery_fee, discount, total, idempotency_key, whatsapp_opened_at |
| `order_items` | Detalle | business_id, order_id, product_id, product_name, unit_price, quantity, subtotal |
| `order_status_history` | Historial de estados | order_id, from_status, to_status, changed_by_id, note |
| `subscriptions` | Suscripción del negocio a Pedify | business_id, plan (`EMPRENDEDOR`/`NEGOCIO`), trial_ends_at, paid_until |
| `subscription_payments` | Pagos registrados por el equipo | business_id, plan, amount, months, method, reference, period_start, period_end, recorded_by_id |
| `password_reset_tokens` | Enlaces para restablecer la contraseña | user_id, token_hash (único), expires_at, used_at |
| `payment_proofs` | Comprobantes de pago por adelantado | business_id, order_id (único; nulo mientras el cliente no envía el pedido), image_key (archivo privado en `private/…`) |
| `payment_accounts` | QR y llaves para cobrar | business_id, kind (`NEQUI`/`BRE_B`/`DAVIPLATA`, única por negocio), account_key, holder_name, qr_payload (código leído del QR), qr_image_url/qr_image_key |

`products` y `categories` se usan desde la fase 2; `customers`, `customer_addresses`, `orders`, `order_items` y `order_status_history`, desde la fase 3.

Pedidos desde la tienda (fase 3): un cliente por celular dentro de cada negocio (el nombre se actualiza con el último pedido); cada dirección nueva se guarda en `customer_addresses` (sin repetir la misma dirección). El pedido copia nombre, celular, dirección y referencias del cliente al momento de pedir.

Imágenes: `*_url` es la dirección pública y `*_key` la clave en el almacenamiento (disco o S3), que permite borrar la versión anterior al reemplazarla. Las claves nunca salen en la API.

Orden del menú: `categories.position` y `products.position` (por categoría). Un producto archivado (`archived_at`) sale del menú y de la tienda, pero sigue referenciado por sus pedidos.

```
users ─┬─ business_memberships ── businesses ─┬─ business_settings
       └─ sessions                            ├─ categories ── products
                                              ├─ customers ── customer_addresses
                                              └─ orders ─┬─ order_items ── products
                                                         └─ order_status_history
```

## Reglas de integridad

- **Aislamiento entre negocios en la base**: `orders (customer_id, business_id) → customers (id, business_id)`, `order_items (order_id, business_id) → orders (id, business_id)` y `order_items (product_id, business_id) → products (id, business_id)`. Es imposible guardar un pedido con productos o clientes de otro negocio, aunque el código tuviera un error.
- `order_items.product_id` usa `ON DELETE RESTRICT`: un producto que aparece en pedidos no se borra, se **archiva** (`archived_at`).
- El nombre y precio del producto se copian en `order_items` para conservar el valor histórico.
- Restricciones `CHECK` (escritas a mano en la migración inicial):
  - `users.email = lower(email)`; `businesses.slug` con formato `a-z0-9-`.
  - Dinero no negativo en productos, configuración y pedidos.
  - `orders.total = subtotal + delivery_fee − discount`.
  - `order_items.quantity > 0` y `subtotal = unit_price × quantity`.
  - Un pedido a domicilio debe tener dirección.
- `orders (business_id, idempotency_key)` es único: un reintento del navegador no duplica el pedido.

## Migraciones

| Migración | Cambio |
|---|---|
| `20261014175128_init` | Esquema completo + restricciones `CHECK` |
| `20261014175905_whatsapp_opcional` | `business_settings.whatsapp_phone` admite null |
| `20261016041728_catalogo_imagenes` | `products.image_key`, `businesses.logo_key`, `businesses.banner_key` |
| `20261016145743_operacion` | `orders.paid_at` (pago recibido) y `business_settings.sales_policy` (`ACCEPTED`/`DELIVERED`/`PAID`) |
| `20261016152621_comercializacion` | Suscripciones, pagos, enlaces de recuperación, administradores y autorización de datos; los negocios existentes reciben 14 días de prueba |

## Zona horaria

Las columnas son `timestamptz` y la aplicación abre cada conexión con `TimeZone=UTC` (`src/config/database.ts`): el adaptador de Prisma envía las fechas en UTC sin zona, y una base configurada en otra zona las guardaría corridas. Los reportes agrupan por día y hora con `AT TIME ZONE` y la zona del negocio (`America/Bogota`).

## Estados de pedido

`PENDING` (pendiente) → `CONFIRMED` → `PREPARING` → `READY` → `OUT_FOR_DELIVERY` (si aplica) → `DELIVERED`; o `CANCELLED`. Cada cambio queda en `order_status_history` con quién lo hizo. Aparte del estado: `whatsapp_opened_at` (el cliente abrió WhatsApp) y `paid_at` (pago recibido).

## Horario (`business_settings.opening_hours`)

```json
[{ "day": 0, "closed": false, "open": "17:00", "close": "23:30" }, …]
```

Siete entradas, `day` 0 = domingo. Si `close` es menor que `open`, el turno termina al día siguiente (p. ej. 18:00–02:00). Se interpreta en `timezone` (por defecto `America/Bogota`).

## Comandos

```bash
npm run db:migrate   # nueva migración en desarrollo
npm run db:deploy    # aplicar migraciones (producción / pruebas)
npm run db:seed      # datos demo
npm run db:studio    # explorar datos
```
