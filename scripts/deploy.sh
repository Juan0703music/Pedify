#!/usr/bin/env bash
# Pedify — despliegue en el servidor con Docker Compose (guía: docs/deployment.md).
#
#   scripts/deploy.sh                 Trae la última versión (git pull), construye, hace una copia de la base,
#                                     aplica las migraciones, arranca y verifica. Si la app no queda sana,
#                                     vuelve sola a la versión anterior.
#   scripts/deploy.sh --no-pull       Igual, con el código que ya está en la carpeta.
#   scripts/deploy.sh rollback [ver]  Vuelve a la versión anterior (o a la indicada, ver: commit corto).
#   scripts/deploy.sh status          Estado de los servicios, versión y última copia.
#
# Las migraciones no se deshacen al revertir: por eso se hace una copia antes de cada despliegue
# (y las migraciones deben ser compatibles con la versión anterior; ver docs/deployment.md).
set -euo pipefail

cd "$(dirname "$0")/.."

APP_IMAGE=pedifyai-app
TOOLS_IMAGE=pedifyai-tools
KEEP_VERSIONS=5
STATE_DIR=.deploy

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_value() {
  # Valor de una variable en .env (sin comillas); vacío si no existe.
  local line
  line="$(grep -E "^$1=" .env | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  printf '%s' "$line"
}

image_exists() { docker image inspect "$1" >/dev/null 2>&1; }

preflight() {
  command -v docker >/dev/null || fail "Docker no está instalado (docs/deployment.md, paso 2)."
  docker compose version >/dev/null 2>&1 || fail "Falta Docker Compose v2 (docker compose)."
  [[ -f .env ]] || fail "No existe .env. Cópialo de deploy/env.example y complétalo."
  if [[ "$(stat -c %a .env)" != "600" ]]; then
    chmod 600 .env && ok ".env ahora solo lo puede leer este usuario (chmod 600)."
  fi

  local missing=()
  for name in DOMAIN POSTGRES_PASSWORD; do
    [[ -n "$(env_value "$name")" ]] || missing+=("$name")
  done
  if [[ "$(env_value STORAGE_DRIVER)" == "s3" ]]; then
    for name in S3_BUCKET S3_PUBLIC_URL S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
      [[ -n "$(env_value "$name")" ]] || missing+=("$name")
    done
  fi
  ((${#missing[@]} == 0)) || fail "Completa en .env: ${missing[*]}"
  [[ "$(env_value POSTGRES_PASSWORD)" =~ ^[A-Za-z0-9]{16,}$ ]] ||
    fail "POSTGRES_PASSWORD debe tener al menos 16 letras o números (openssl rand -hex 24)."
  docker compose config --quiet || fail "docker-compose.yml o .env tienen un error."
  ok "Configuración completa ($(env_value APP_ENV || true) · $(env_value DOMAIN))."
}

app_health() {
  local id
  id="$(docker compose ps -q app 2>/dev/null || true)"
  [[ -n "$id" ]] || { echo "sin-contenedor"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id"
}

wait_healthy() {
  local status
  for _ in $(seq 1 45); do
    status="$(app_health)"
    [[ "$status" == "healthy" ]] && return 0
    sleep 2
  done
  echo "  Estado de la app: $status" >&2
  return 1
}

smoke_target() {
  local domain
  domain="$(env_value DOMAIN)"
  # En un PC de pruebas (localhost) se verifica la app dentro de la red de Docker.
  if [[ "$domain" == "localhost" ]]; then echo "http://app:3000"; else echo "https://$domain"; fi
}

run_smoke() {
  local target
  target="$(smoke_target)"
  # Recién instalado, Caddy puede tardar unos segundos en obtener el certificado.
  for attempt in 1 2 3 4 5 6; do
    if docker compose run --rm --no-deps -T tools npx tsx scripts/smoke.ts "$target"; then return 0; fi
    ((attempt < 6)) && { echo "  Reintentando en 10 s…"; sleep 10; }
  done
  return 1
}

use_version() {
  # Hace que "latest" apunte a la versión indicada (la que usa docker compose).
  docker tag "$APP_IMAGE:$1" "$APP_IMAGE:latest"
  docker tag "$TOOLS_IMAGE:$1" "$TOOLS_IMAGE:latest"
}

prune_versions() {
  local image tags
  for image in "$APP_IMAGE" "$TOOLS_IMAGE"; do
    tags="$(docker image ls "$image" --format '{{.Tag}}' | grep -v -E '^(latest|previous|<none>)$' | tail -n +$((KEEP_VERSIONS + 1)) || true)"
    for tag in $tags; do docker image rm "$image:$tag" >/dev/null 2>&1 || true; done
  done
  docker image prune -f >/dev/null
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
}

rollback() {
  local target="${1:-previous}"
  image_exists "$APP_IMAGE:$target" || fail "No hay una versión '$target' guardada en este servidor (docker image ls $APP_IMAGE)."
  say "Volviendo a la versión $target"
  use_version "$target"
  docker compose up -d --no-deps app
  wait_healthy || fail "La versión $target tampoco quedó sana: revisa 'docker compose logs app'."
  ok "App sana con la versión $target."
  echo "$(date -u '+%F %T') rollback $target" >>"$STATE_DIR/history"
  echo "  Las migraciones no se deshicieron. Si la versión nueva cambió la base de una forma incompatible,"
  echo "  restaura la copia previa al despliegue (docs/deployment.md, «Revertir»)."
}

deploy() {
  local pull=1
  [[ "${1:-}" == "--no-pull" ]] && pull=0

  preflight
  mkdir -p "$STATE_DIR"

  if ((pull)); then
    say "Trayendo la última versión"
    git pull --ff-only
  fi
  local version
  version="$(git rev-parse --short HEAD)"
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || version="$version-local"
  ok "Versión $version: $(git log -1 --format=%s)"

  say "Construyendo las imágenes"
  local had_previous=0
  if image_exists "$APP_IMAGE:latest"; then
    docker tag "$APP_IMAGE:latest" "$APP_IMAGE:previous"
    docker tag "$TOOLS_IMAGE:latest" "$TOOLS_IMAGE:previous"
    had_previous=1
  fi
  docker compose build tools app
  docker tag "$APP_IMAGE:latest" "$APP_IMAGE:$version"
  docker tag "$TOOLS_IMAGE:latest" "$TOOLS_IMAGE:$version"
  ok "Imágenes $APP_IMAGE:$version y $TOOLS_IMAGE:$version"

  # Si algo falla antes de arrancar, "latest" vuelve a ser la versión que está funcionando.
  abort() {
    if ((had_previous)); then use_version previous; fi
    fail "$1"
  }

  say "Base de datos"
  docker compose up -d --wait db >/dev/null || abort "PostgreSQL no arrancó: docker compose logs db"
  if [[ "$(docker compose exec -T db psql -U pedifyai -d pedifyai -tAc "SELECT to_regclass('public.orders') IS NOT NULL")" == "t" ]]; then
    say "Copia de seguridad antes de migrar"
    docker compose run --rm -T backup once || abort "La copia de seguridad falló: no se aplicó ningún cambio."
  else
    ok "Base nueva: no hay datos que copiar."
  fi

  say "Migraciones"
  docker compose run --rm -T tools || abort "Las migraciones fallaron (la app sigue con la versión anterior). Revisa el error de arriba."

  say "Arrancando"
  docker compose up -d --remove-orphans
  if ! wait_healthy; then
    docker compose logs --tail 40 app >&2 || true
    if ((had_previous)); then
      echo "  La versión $version no quedó sana: vuelvo a la anterior." >&2
      rollback previous
      exit 1
    fi
    fail "La app no quedó sana. Revisa 'docker compose logs app'."
  fi
  ok "App sana."

  say "Verificación desde afuera ($(smoke_target))"
  if ! run_smoke; then
    fail "La app está sana pero la verificación falló: revisa el DNS del dominio, el firewall (puertos 80 y 443) y 'docker compose logs caddy'."
  fi

  echo "$(date -u '+%F %T') deploy $version" >>"$STATE_DIR/history"
  prune_versions
  say "Listo: versión $version en https://$(env_value DOMAIN)"
}

status() {
  docker compose ps
  echo
  echo "Salud de la app: $(app_health)"
  [[ -f "$STATE_DIR/history" ]] && echo "Último despliegue: $(tail -n 1 "$STATE_DIR/history")"
  echo "Última copia: $(docker compose logs --no-log-prefix backup 2>/dev/null | grep -E 'Restauración verificada|ERROR' | tail -n 1 || echo 'sin registros')"
}

case "${1:-deploy}" in
  deploy | --no-pull) deploy "${1:-}" ;;
  rollback) preflight && rollback "${2:-previous}" ;;
  status) status ;;
  -h | --help | help) sed -n '2,12p' "$0" ;;
  *) fail "Comando desconocido: $1 (usa deploy, rollback o status)" ;;
esac
