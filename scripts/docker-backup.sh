#!/bin/sh
# PedifyAI — copias de seguridad en Docker (servicio `backup` de docker-compose.yml).
#  1. pg_dump de la base (formato personalizado, comprimido).
#  2. Prueba de restauración: se restaura en una base temporal, se comparan los pedidos y se borra.
#  3. Copia de las fotos guardadas en disco (volumen uploads).
#  4. Conserva BACKUP_KEEP_DAYS días de copias.
#
#   sh docker-backup.sh        → una copia cada BACKUP_INTERVAL_SECONDS (24 h), para siempre
#   sh docker-backup.sh once   → una sola copia (la usa scripts/deploy.sh antes de migrar); sale con error si falla
#
# Recomendado: el servicio `offsite` sube las copias a un almacenamiento externo, fuera del servidor.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
mkdir -p /backups

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"; }

backup_once() {
  STAMP="$(date -u +%Y%m%d%H%M%S)"
  FILE="/backups/pedifyai-${STAMP}.dump"
  log "Copia ${FILE}"

  if ! pg_dump --format=custom --file="${FILE}.tmp"; then
    rm -f "${FILE}.tmp"
    log "ERROR: pg_dump falló." >&2
    return 1
  fi
  mv "${FILE}.tmp" "${FILE}"

  STATUS=0
  CHECK_DB="pedifyai_verificacion_${STAMP}"
  if createdb "${CHECK_DB}" && pg_restore --no-owner --exit-on-error --dbname="${CHECK_DB}" "${FILE}"; then
    RESTORED="$(psql --dbname="${CHECK_DB}" -tAc 'SELECT count(*) FROM orders')"
    CURRENT="$(psql -tAc 'SELECT count(*) FROM orders')"
    # La copia es una foto del momento: puede tener menos pedidos que ahora, nunca más.
    if [ "${RESTORED}" -le "${CURRENT}" ]; then
      log "Restauración verificada: ${RESTORED} pedidos ($(du -h "${FILE}" | cut -f1))."
    else
      log "ERROR: la copia restaurada no coincide (${RESTORED} > ${CURRENT})." >&2
      STATUS=1
    fi
  else
    log "ERROR: no se pudo restaurar la copia ${FILE}." >&2
    STATUS=1
  fi
  dropdb --if-exists "${CHECK_DB}" || true

  if [ -d /uploads ] && [ -n "$(ls -A /uploads 2>/dev/null)" ]; then
    tar -czf "/backups/uploads-${STAMP}.tar.gz" -C /uploads . && log "Fotos copiadas."
  fi

  find /backups -name 'pedifyai-*.dump' -mtime +"${KEEP_DAYS}" -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +"${KEEP_DAYS}" -delete
  return "${STATUS}"
}

if [ "${1:-}" = "once" ]; then
  backup_once
  exit $?
fi

while true; do
  backup_once || true
  sleep "${INTERVAL}"
done
