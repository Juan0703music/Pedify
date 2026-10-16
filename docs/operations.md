# Operación en producción

Guía para desplegar, vigilar y respaldar PedifyAI (fase 5 del documento: suscripciones, monitoreo, copias y mejoras; secciones 12, 13 y 15).

## 1. Antes de comercializar

La sección 15 pide implementar **y probar** migraciones, validaciones, controles de acceso, gestión de secretos, copias de seguridad y procedimientos de despliegue. Lista de verificación:

- [ ] Dominio con HTTPS (`APP_URL=https://…`, `COOKIE_SECURE=true`, `TRUST_PROXY=1` detrás del proxy).
- [ ] Proxy con WebSocket habilitado en `/socket.io/` (cabeceras `Upgrade` y `Connection`).
- [ ] Secretos solo en variables de entorno (nunca en el repositorio): `DATABASE_URL`, `SMTP_URL`, `S3_*`, `METRICS_TOKEN`.
- [ ] Imágenes en almacenamiento externo (`STORAGE_DRIVER=s3`) con el bucket **versionado**.
- [ ] Correo configurado (`SMTP_URL`) y probada la recuperación de contraseña.
- [ ] `SUPPORT_WHATSAPP` con el número del equipo (pagos de planes y soporte).
- [ ] Copias automáticas activas y **una restauración probada** (ver 4).
- [ ] Monitoreo de `/api/v1/health` y de `/metrics` (ver 5).
- [ ] Política de tratamiento de datos (`/privacidad`) completada con razón social, NIT, dirección y correo, y revisada por un abogado (Ley 1581 de 2012).
- [ ] Un administrador de la plataforma asignado (ver 3).
- [ ] Entorno de pruebas separado de producción (otra base de datos y otro dominio).

## 2. Variables de entorno

Todas están documentadas en [`.env.example`](../.env.example). Las nuevas de la fase 5:

| Variable | Para qué |
|---|---|
| `SMTP_URL`, `MAIL_FROM` | Correos de recuperación de contraseña. Sin `SMTP_URL`, en desarrollo el enlace aparece en el registro; en producción no se envía (y se registra una advertencia). |
| `SUPPORT_WHATSAPP` | WhatsApp del equipo (57XXXXXXXXXX). Lo usan "Mi plan" y los botones de pago. |
| `METRICS_TOKEN` | Activa `/metrics` (mínimo 16 caracteres). Sin token, la ruta no existe. |

## 3. Planes, suscripciones y panel central

- Planes y precios: [`src/modules/subscriptions/plans.ts`](../src/modules/subscriptions/plans.ts) (**Emprendedor** $39.900 · 40 productos · 2 personas; **Negocio** $69.900 · 300 productos · 6 personas). Si cambias un precio, cambia también la portada (`public/index.html`): una prueba verifica que coincidan.
- Cada negocio nuevo empieza con **14 días de prueba** del plan Negocio. Estados: prueba → activo (pagado) → vencido con **5 días de gracia** (sigue recibiendo pedidos) → vencido (la tienda se ve pero no recibe pedidos en línea; el panel sigue funcionando). El estado se calcula con fechas; no hay tareas programadas.
- Los pagos se reciben por Nequi, Daviplata o transferencia y se **registran en el panel central** (`/admin`): extiende el periodo desde la fecha más tardía entre hoy, lo ya pagado y el fin de la prueba.
- Administradores: solo por consola, nunca desde la web.

  ```bash
  npm run admin:grant -- correo@pedifyai.com
  npm run admin:revoke -- correo@pedifyai.com
  ```

- En `/admin`: métricas globales (negocios por estado, ingreso mensual estimado, pedidos y ventas de las tiendas, salud del sistema), lista de negocios con búsqueda y filtros, registrar pagos, cambiar de plan, ampliar la prueba y suspender o reactivar un negocio (suspendido: sin panel ni tienda, y sus paneles en vivo se desconectan en menos de un minuto).

## 4. Copias de seguridad

### Docker (recomendado en el servidor)

El servicio `backup` de `docker-compose.yml` ejecuta [`scripts/docker-backup.sh`](../scripts/docker-backup.sh) cada 24 horas:

1. `pg_dump` en formato personalizado al volumen `backups`.
2. **Prueba de restauración**: restaura la copia en una base temporal, compara los pedidos y la borra. El resultado queda en el registro (`docker compose logs backup`).
3. Copia de las fotos (volumen `uploads`).
4. Conserva `BACKUP_KEEP_DAYS` días (14 por defecto).

Sincroniza el volumen `backups` con un almacenamiento externo (por ejemplo `rclone sync` a S3/R2): una copia en el mismo servidor no protege contra la pérdida del servidor.

Restaurar una copia de Docker en una base nueva:

```bash
docker compose exec backup sh -c 'createdb pedifyai_restaurada && pg_restore --no-owner -d pedifyai_restaurada /backups/pedifyai-AAAAMMDDHHMMSS.dump'
```

### Sin Docker (`npm`)

No necesita `pg_dump`: usa `COPY` de PostgreSQL dentro de una transacción de solo lectura.

```bash
npm run db:backup                 # copia en backups/ (BACKUP_DIR), conserva las últimas 14 (BACKUP_KEEP)
npm run db:backup:verify          # restaura la última copia en una base temporal, compara filas e integridad, y la borra
npm run db:restore -- backups/pedifyai-… --target postgresql://…/base_vacia --yes [--with-uploads uploads]
```

`db:restore` aplica las migraciones en la base de destino y **se niega a escribir sobre una base con datos**. `db:backup:verify` necesita permiso para crear bases de datos (en producción, ejecútalo contra el entorno de pruebas).

Haz al menos una prueba de restauración al mes y después de cada cambio de infraestructura.

## 5. Monitoreo

| Qué | Dónde |
|---|---|
| Salud | `GET /api/v1/health` → `{ status, version, uptimeSeconds, database: { status, latencyMs } }`; **503** si la base no responde. Lo usa el `HEALTHCHECK` de Docker. |
| Métricas | `GET /metrics` con `Authorization: Bearer <METRICS_TOKEN>` (formato Prometheus): peticiones y duración por ruta y estado, pedidos creados, paneles conectados en vivo, memoria y tiempo en línea. |
| Registros | JSON (pino) en la salida estándar, sin contraseñas, tokens ni cookies. Cada petición lleva `requestId` (cabecera `X-Request-Id`). |
| Errores | Un error 500 muestra al usuario un **código de soporte** (los primeros 8 caracteres del `requestId`); con él se encuentra el detalle en los registros. |

Alertas sugeridas: salud distinta de 200 por más de 2 minutos; tasa de respuestas 5xx; `pedifyai_socket_connections` en 0 en horario de atención; la copia diaria sin el mensaje "Restauración verificada".

## 6. Datos personales (Ley 1581 de 2012)

- El comerciante autoriza el tratamiento al registrarse (se guarda la fecha en `users.privacy_accepted_at`).
- El cliente de una tienda ve el aviso y el enlace a la política antes de enviar su pedido.
- **Supresión**: desde Clientes, el propietario puede eliminar los datos de un cliente que lo pida. Se anonimizan su nombre, celular y direcciones (también la copia en sus pedidos); los valores de los pedidos se conservan para la contabilidad.
- PedifyAI es **responsable** de los datos de los comerciantes y **encargado** de los datos de los clientes de cada tienda (el negocio es el responsable).

## 7. Desplegar una versión nueva

```bash
git pull
docker compose build
docker compose run --rm migrate   # aplica migraciones pendientes
docker compose up -d app
curl -fsS https://tu-dominio/api/v1/health
```

Antes de migrar en producción: copia de seguridad reciente y verificada. Las migraciones se prueban primero en el entorno de pruebas.
