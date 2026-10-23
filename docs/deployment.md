# Puesta en producción

Guía paso a paso para publicar Pedify en un servidor propio y probarlo con un negocio real. Cubre lo que el documento de arquitectura pide antes de comercializar:

- **Sección 13**: dominio con HTTPS, backend y PostgreSQL separados, almacenamiento externo de fotos, copias automáticas, registros de errores, entorno de pruebas separado y despliegue en contenedores, sin Kubernetes ni microservicios.
- **Sección 15**: CSS compilado para producción y procedimientos de migración, secretos, copias y despliegue implementados y **probados**.
- **Sección 16**: validar el MVP con un negocio real antes de ampliar el alcance.

```
INTERNET → DOMINIO HTTPS → Caddy (certificado automático) → app (Express + Socket.IO) → PostgreSQL
                                                            └→ fotos en Cloudflare R2 (S3)
copias: backup (diaria + prueba de restauración) → offsite (copia fuera del servidor)
```

Archivos: [`docker-compose.yml`](../docker-compose.yml) · [`deploy/Caddyfile`](../deploy/Caddyfile) · [`deploy/env.example`](../deploy/env.example) · [`scripts/deploy.sh`](../scripts/deploy.sh) · [`scripts/smoke.ts`](../scripts/smoke.ts) · [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). La operación diaria (planes, copias y monitoreo) está en [`operations.md`](operations.md).

## 1. Qué necesitas

| Qué | Para qué | Opciones (costo aproximado) |
|---|---|---|
| Servidor de producción | La aplicación y la base de datos | Un VPS con Ubuntu 24.04 LTS, **2 GB de RAM**, 1–2 vCPU y 40 GB de disco (Hetzner, DigitalOcean, Vultr, Contabo…: unos US$5–12 al mes) |
| Servidor de pruebas | Entorno de pruebas separado | El VPS más pequeño de 1–2 GB |
| Dominio | `pedifyai.com` y `pruebas.pedifyai.com` | Un `.com` cuesta unos US$10–15 al año |
| Cloudflare R2 | Fotos y copias externas | Gratis hasta 10 GB; sin costo por descargas |
| Correo SMTP | Recuperar la contraseña | Brevo (300 correos diarios gratis), Zoho, Amazon SES… |
| Un número de WhatsApp | Pagos de planes y soporte | El del equipo |
| Monitor externo | Aviso si el sitio se cae | UptimeRobot o Better Stack (plan gratis) |

También necesitas el repositorio en GitHub (privado). Al subirlo se activa la integración continua: cada cambio pasa las pruebas y **un despliegue completo con Docker** antes de llegar a `main` (ver 13).

## 2. Preparar el servidor (una sola vez)

Conéctate como `root` y crea un usuario para operar:

```bash
adduser pedify && usermod -aG sudo pedify
rsync --archive --chown=pedify:pedify ~/.ssh /home/pedify   # copia tu llave SSH al usuario nuevo
```

Desde ahora entra como `pedify` (`ssh pedify@IP`) e instala lo necesario:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 docker-buildx git ufw unattended-upgrades
sudo usermod -aG docker pedify          # sal y vuelve a entrar para que tome efecto

# Firewall: solo SSH y la web. PostgreSQL nunca se publica.
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable

# 2 GB de memoria de intercambio: la construcción de la imagen la necesita en servidores pequeños.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Actualizaciones de seguridad automáticas.
sudo dpkg-reconfigure -plow unattended-upgrades
```

Desactiva el ingreso por contraseña y el de `root` en `/etc/ssh/sshd_config` (`PasswordAuthentication no`, `PermitRootLogin no`) y reinicia SSH con `sudo systemctl restart ssh`. **Antes de cerrar la sesión**, comprueba en otra terminal que puedes entrar con tu llave.

## 3. Dominio (DNS)

En el administrador de tu dominio crea un registro **A**:

| Nombre | Apunta a |
|---|---|
| `@` (pedifyai.com) | IP del servidor de producción |
| `pruebas` | IP del servidor de pruebas |

Si usas Cloudflare como DNS, deja la nube en gris (solo DNS) para que Caddy obtenga el certificado sin intermediarios. Comprueba con `ping pedifyai.com` que ya responde la IP correcta antes de desplegar.

## 4. Fotos y copias en Cloudflare R2

1. En Cloudflare → R2, crea dos buckets: **`pedifyai-fotos`** y **`pedifyai-copias`**. En pruebas usa otros dos (`pedifyai-fotos-pruebas`, `pedifyai-copias-pruebas`).
2. Fotos públicas: en `pedifyai-fotos` → Settings → Custom Domains, conecta `fotos.pedifyai.com`. Esa es tu `S3_PUBLIC_URL`. La dirección `r2.dev` tiene límites de uso y solo sirve para probar.
   Los comprobantes de pago de los clientes se guardan en la carpeta `private/` del mismo bucket y Pedify los entrega solo al equipo del negocio. Si el dominio público sirve todo el bucket, bloquea esa carpeta: en Cloudflare → Security → WAF, una regla que bloquee `http.host eq "fotos.pedifyai.com" and starts_with(http.request.uri.path, "/private/")`.
3. `pedifyai-copias` **no** debe ser público. En Settings → Object lifecycle rules, agrega una regla que borre los objetos después de 90 días.
4. Crea dos tokens de API (R2 → Manage API tokens), cada uno con permiso *Object Read & Write* limitado a **un** bucket: uno para las fotos (`S3_*`) y otro para las copias (`OFFSITE_*`).
5. El endpoint es `https://<ID-de-cuenta>.r2.cloudflarestorage.com` (aparece en la página de R2).

## 5. Código y configuración

Da acceso de **solo lectura** al repositorio con una llave de despliegue:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pedifyai_deploy -N ""
cat ~/.ssh/pedifyai_deploy.pub     # GitHub → el repositorio → Settings → Deploy keys → Add (sin permiso de escritura)
printf 'Host github.com\n  IdentityFile ~/.ssh/pedifyai_deploy\n' >> ~/.ssh/config

git clone git@github.com:<usuario>/pedifyai.git && cd pedifyai
cp deploy/env.example .env && chmod 600 .env
nano .env
```

Completa `.env` (cada variable está explicada en el archivo):

| Variable | Producción | Pruebas |
|---|---|---|
| `APP_ENV` | `production` | `staging` |
| `DOMAIN` | `pedifyai.com` | `pruebas.pedifyai.com` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | otra distinta |
| `STORAGE_DRIVER`, `S3_*` | bucket `pedifyai-fotos` | bucket `pedifyai-fotos-pruebas` |
| `SMTP_URL` | p. ej. `smtp://usuario:clave@smtp-relay.brevo.com:587` | el mismo proveedor |
| `SUPPORT_WHATSAPP`, `METRICS_TOKEN` | `57XXXXXXXXXX`, `openssl rand -hex 24` | igual |
| `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_EVENTS_SECRET`, `WOMPI_INTEGRITY_SECRET` | llaves de producción de Wompi | llaves de prueba (sandbox) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npm run push:keys` | otras distintas |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | vacías (OpenStreetMap) o un proveedor de mapas con llave | igual |
| `COMPOSE_PROFILES=offsite` y `OFFSITE_*` | bucket `pedifyai-copias` | bucket `pedifyai-copias-pruebas` |
| `DEMO_PASSWORD` | (vacío) | una clave para la cuenta demo |

Reglas para los secretos:

- Solo viven en el `.env` del servidor (`chmod 600`). Nunca en el repositorio, en capturas ni en chats.
- Producción y pruebas **no comparten** contraseñas, buckets ni tokens.
- Si una clave de la URL de SMTP tiene caracteres como `@`, `:` o `/`, escríbelos codificados (`%40`, `%3A`, `%2F`).
- Si un secreto se filtra, cámbialo en el proveedor y en `.env`, y ejecuta `scripts/deploy.sh --no-pull`.
- Para que los correos no lleguen a spam, configura en tu dominio los registros SPF y DKIM que indique el proveedor de correo.

## 6. Primer despliegue

```bash
scripts/deploy.sh --no-pull
```

El script revisa `.env`, construye las imágenes, levanta PostgreSQL, hace una copia si ya hay datos, aplica las migraciones y arranca Caddy, la app y las copias. Luego espera a que la app esté sana y la verifica **desde afuera** por HTTPS. Si la versión nueva no queda sana, vuelve sola a la anterior. Al terminar debe decir `Listo: versión … en https://pedifyai.com`.

Después:

1. Regístrate en `https://pedifyai.com/registro` con el correo del equipo.
2. Hazte administrador: `docker compose run --rm tools npm run admin:grant -- tu@correo.com`.
3. Abre `/admin`. El recuadro **«Pendiente de configurar en el servidor»** no debe aparecer; si aparece, dice exactamente qué falta.
4. Prueba «¿La olvidaste?» en `/login` y comprueba que el correo llega.
5. Crea un producto con foto (debe guardarse en R2) y haz un pedido desde tu celular hasta WhatsApp, mirando el panel en vivo en el computador.

Verificación desde tu PC, en cualquier momento:

```bash
npm run smoke -- https://pedifyai.com
```

Revisa salud y base de datos, cabeceras de seguridad, HTTPS (redirección y vencimiento del certificado), CSS de producción comprimido, rutas protegidas, `robots.txt` y el canal en vivo por WebSocket a través del proxy. Solo lee: no crea datos.

### Avisos push de pedidos

Con las llaves VAPID, cada persona del equipo activa los avisos en su celular o computador (Inicio, menú del panel o Configuración → Pedidos) y le llega una notificación con cada pedido nuevo aunque tenga el panel cerrado; al tocarla se abre el pedido.

- Funcionan solo con HTTPS (en producción ya lo tienes con Caddy; en el PC, solo en `http://localhost`).
- Android, Windows, Mac y Linux: Chrome, Edge, Firefox o Safari actualizados.
- iPhone y iPad (iOS 16.4 o más): primero hay que **agregar Pedify a la pantalla de inicio** (Compartir → «Agregar a pantalla de inicio») y activar los avisos desde ese ícono. El panel lo explica.
- Al cerrar sesión en un dispositivo, ese dispositivo deja de recibir avisos; «Cerrar sesión en todos» y el cambio de contraseña los quitan todos.

### Pago de los planes con Wompi

Wompi (de Bancolombia) cobra los planes y consigna el dinero en tu cuenta bancaria, de cualquier banco.

1. Crea la cuenta en [comercios.wompi.co](https://comercios.wompi.co) (persona natural con RUT o empresa) y registra la cuenta bancaria donde quieres recibir los pagos. Wompi revisa los datos antes de activar los cobros reales.
2. En **Desarrolladores** copia las llaves: en el servidor de pruebas, las de prueba (`pub_test_…`, `prv_test_…` y los secretos `test_events_…`, `test_integrity_…`); en producción, las de producción (`…prod…`). Ponlas en `.env` y ejecuta `scripts/deploy.sh --no-pull`.
3. En la misma sección, en **URL de eventos**, escribe `https://<tu-dominio>/api/v1/webhooks/wompi` (una para pruebas y otra para producción).
4. Prueba en el entorno de pruebas desde «Mi plan»: tarjeta `4242 4242 4242 4242` (aprobada) o `4111 1111 1111 1111` (rechazada), con cualquier fecha futura y CVC; Nequi `3991111111` (aprobada) o `3992222222` (rechazada).
5. En producción, haz un pago real con tu propio negocio, revisa que el plan se extienda y que aparezca en `/admin`, y confirma en el panel de Wompi cuándo te consigna.

Cada pago aprobado extiende el plan aunque el aviso de Wompi tarde: al volver a Pedify, «Mi plan» consulta la transacción con la llave privada. Si Wompi no puede entregar el aviso (por ejemplo, la URL de eventos está mal), lo reintenta durante 24 horas.

### Mapa del domicilio

- La ubicación del cliente y del domiciliario **solo funciona con HTTPS** (en el PC, en `http://localhost`); por eso hay que probarlo con el dominio publicado.
- El domiciliario debe dejar la página abierta: si apaga la pantalla o cambia de aplicación, el celular deja de enviar la ubicación hasta que vuelva.
- OpenStreetMap permite un uso moderado de sus mapas. Con muchos pedidos al día, crea una cuenta gratuita en un proveedor (MapTiler, Stadia Maps…) y pon su dirección de teselas con tu llave en `MAP_TILE_URL` y su atribución en `MAP_TILE_ATTRIBUTION`.

## 7. Entorno de pruebas

Es una copia completa en **otro servidor**, con su propia base, sus propios buckets y `APP_ENV=staging`. Repite los pasos 2 a 6 con los valores de la columna «Pruebas». En ese entorno:

- Todas las páginas muestran una franja de obra con la etiqueta **«Entorno de pruebas»**, y las pestañas y los correos empiezan por **[Pruebas]**.
- Los buscadores no lo indexan (`robots.txt` bloquea todo y cada respuesta lleva `X-Robots-Tag: noindex`).
- Puedes cargar la cuenta de demostración: `docker compose run --rm tools npm run db:seed` (usa `DEMO_PASSWORD`; en producción el seed se niega a ejecutarse).

Los enlaces de WhatsApp del entorno de pruebas son reales: usa números de prueba en los negocios de ese entorno. **Nunca copies datos de clientes reales a pruebas** (Ley 1581).

## 8. Actualizar a una versión nueva

Cada cambio sigue el mismo camino: **PC → GitHub (pruebas automáticas) → entorno de pruebas → producción**.

```bash
# En el servidor de pruebas y, cuando todo esté bien, en el de producción:
cd ~/pedifyai && scripts/deploy.sh
```

- Despliega en producción en horas de poco movimiento (media tarde o después del cierre), nunca en la hora del almuerzo o de la cena.
- La app se reinicia en pocos segundos; los paneles abiertos se reconectan solos y vuelven a cargar los pedidos.
- `scripts/deploy.sh status` muestra los servicios, la salud, el último despliegue y la última copia.
- Imágenes base (PostgreSQL, Caddy, rclone): una vez al mes, `docker compose pull && scripts/deploy.sh --no-pull`.

### Migraciones compatibles

Revertir la app **no deshace las migraciones**. Cada migración debe funcionar también con la versión anterior del código:

- Agregar tablas, o columnas que acepten vacío o tengan un valor por defecto: sí.
- Renombrar o borrar una columna: en dos versiones. Primero el código deja de usarla y se despliega; en la versión siguiente se borra.
- Antes de producción, toda migración pasa por el entorno de pruebas con datos de ejemplo.

## 9. Revertir

```bash
scripts/deploy.sh rollback            # vuelve a la versión anterior
docker image ls pedifyai-app          # versiones guardadas (las últimas 5)
scripts/deploy.sh rollback a1b2c3d    # vuelve a una versión concreta
```

Si la versión con problemas aplicó una migración incompatible, restaura la copia que se hizo justo antes del despliegue:

```bash
docker compose stop app caddy
docker compose exec backup ls -1t /backups | head -3          # la más reciente es la previa al despliegue
docker compose exec backup psql -d postgres -c 'ALTER DATABASE pedifyai RENAME TO pedifyai_fallida'
docker compose exec backup createdb pedifyai
docker compose exec backup pg_restore --no-owner --dbname=pedifyai /backups/pedifyai-AAAAMMDDHHMMSS.dump
scripts/deploy.sh rollback
docker compose up -d caddy
```

Los pedidos recibidos entre la copia y la restauración quedan en `pedifyai_fallida`. Revísalos antes de borrarla con `dropdb pedifyai_fallida`.

## 10. Copias de seguridad

- **Diaria**: el servicio `backup` guarda `pg_dump` y las fotos en disco, **restaura la copia en una base temporal** y compara los pedidos. Consulta el resultado con `docker compose logs backup | tail`.
- **Antes de cada despliegue**: `scripts/deploy.sh` hace una copia y no migra si falla.
- **Fuera del servidor**: con `COMPOSE_PROFILES=offsite`, el servicio `offsite` sube las copias a R2 cada 6 horas. Consulta el resultado con `docker compose logs offsite | tail`. Una copia guardada solo en el mismo servidor no protege si se pierde el servidor.
- **Cada mes**: revisa en R2 que haya copias recientes y haz un simulacro de restauración a mano. Una copia que nunca se ha restaurado no está probada.

  ```bash
  docker compose exec backup sh -c 'createdb simulacro && pg_restore --no-owner -d simulacro /backups/pedifyai-AAAAMMDDHHMMSS.dump && psql -d simulacro -c "SELECT count(*) FROM orders" && dropdb simulacro'
  ```

**Si se pierde el servidor:**

1. Prepara uno nuevo (pasos 2, 3 y 5) con el **mismo** `.env`, guardado en un gestor de contraseñas.
2. Descarga la copia más reciente desde el bucket `pedifyai-copias` en el panel de Cloudflare y cópiala al servidor con `scp`.
3. Restaura la copia en la base vacía:

   ```bash
   docker compose up -d db backup
   docker compose cp pedifyai-AAAAMMDDHHMMSS.dump backup:/backups/
   docker compose exec backup pg_restore --no-owner --dbname=pedifyai /backups/pedifyai-AAAAMMDDHHMMSS.dump
   scripts/deploy.sh --no-pull
   ```

4. Las fotos siguen en R2. Si estaban en disco, restaura `uploads-….tar.gz` en el volumen `uploads`.

## 11. Monitoreo

| Qué | Cómo |
|---|---|
| ¿Está en línea? | UptimeRobot o Better Stack contra `https://pedifyai.com/api/v1/health` cada 5 minutos, con aviso al correo o a Telegram. |
| Errores | `docker compose logs -f app`. Un error muestra al usuario un **código de soporte**; búscalo con `docker compose logs app \| grep <código>`. |
| Configuración | El recuadro «Pendiente de configurar» de `/admin` y las advertencias al arrancar (`docker compose logs app \| grep Configuración`). |
| Métricas | `/metrics` con `Authorization: Bearer <METRICS_TOKEN>` (Prometheus o Grafana Cloud, opcional). |
| Disco | `df -h` y `docker system df`. El despliegue borra las imágenes viejas y los registros de Docker rotan (10 MB × 5 por servicio). |

## 12. Piloto con un negocio real (sección 16)

El documento pide demostrar valor con un negocio real antes de ampliar el alcance. Propuesta: **1 a 3 negocios durante 2 a 4 semanas**, gratis. Para eso, amplía la prueba desde `/admin`.

**Día 1, con el negocio:**

1. Crear la cuenta juntos y configurar el WhatsApp, el horario, el domicilio, el pedido mínimo y los métodos de pago.
2. Cargar el menú con fotos y medir cuánto tardan.
3. Imprimir el QR (Mi tienda → QR) para el mostrador y las mesas, y poner el enlace en el estado de WhatsApp y en Instagram.
4. Hacer un pedido de prueba desde el celular del dueño, de la tienda al WhatsApp, y verlo llegar al panel.
5. Enseñar al equipo el panel de pedidos: activar el sonido, confirmar, preparar y entregar.

**Cada semana, en `/admin` y en las Analíticas del negocio:**

- Pedidos por Pedify y qué parte de ellos llegó a abrir WhatsApp.
- Tiempo hasta confirmar, pedidos cancelados y sus motivos, productos agotados.
- Qué le costó al negocio, qué pidió y si **pagaría** el plan al terminar el piloto.

Decide con esos datos qué mejorar antes de abrir el registro a más negocios. Las funciones de la segunda versión (pagos en línea, WhatsApp oficial, IA, inventario) se priorizan según lo que pidan los pilotos.

## 13. Probar el despliegue en tu PC

Con Docker instalado puedes levantar el stack completo localmente:

```bash
cp deploy/env.example .env.docker
# en .env.docker: DOMAIN=localhost, STORAGE_DRIVER=local, POSTGRES_PASSWORD=<openssl rand -hex 24>
docker compose --env-file .env.docker up -d --build
```

Abre `https://localhost`. Caddy usa un certificado local y el navegador pedirá aceptarlo. Los scripts (`scripts/deploy.sh`) leen `.env`, así que en un PC de desarrollo usa los comandos de `docker compose` directamente. La integración continua de GitHub hace exactamente esta prueba en cada cambio: despliegue, verificación por HTTPS, copia con restauración, segundo despliegue y reversión.
