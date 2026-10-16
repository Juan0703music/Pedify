#!/bin/sh
# PedifyAI — copia de seguridad diaria en Docker (servicio `backup` de docker-compose.yml).
#  1. pg_dump de la base (formato personalizado, comprimido).
#  2. Prueba de restauración: se restaura en una base temporal, se comparan los pedidos y se borra.
#  3. Copia de las fotos guardadas en disco (volumen uploads).
#  4. Conserva BACKUP_KEEP_DAYS días de copias.
# Recomendado: sincronizar el volumen de copias a un almacenamiento externo (S3, R2…) fuera del servidor.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
mkdir -p /backups

while true; do
  STAMP="$(date -u +%Y%m%d%H%M%S)"
  FILE="/backups/pedifyai-${STAMP}.dump"
  echo "[$(date -u)] Copia ${FILE}"

  if pg_dump --format=custom --file="${FILE}.tmp" && mv "${FILE}.tmp" "${FILE}"; then
    CHECK_DB="pedifyai_verificacion_${STAMP}"
    if createdb "${CHECK_DB}" && pg_restore --no-owner --exit-on-error --dbname="${CHECK_DB}" "${FILE}"; then
      RESTORED="$(psql --dbname="${CHECK_DB}" -tAc 'SELECT count(*) FROM orders')"
      CURRENT="$(psql -tAc 'SELECT count(*) FROM orders')"
      # La copia es una foto del momento: puede tener menos pedidos que ahora, nunca más.
      if [ "${RESTORED}" -le "${CURRENT}" ]; then
        echo "[$(date -u)] Restauración verificada: ${RESTORED} pedidos."
      else
        echo "[$(date -u)] ERROR: la copia restaurada no coincide (${RESTORED} > ${CURRENT})." >&2
      fi
    else
      echo "[$(date -u)] ERROR: no se pudo restaurar la copia ${FILE}." >&2
    fi
    dropdb --if-exists "${CHECK_DB}" || true
  else
    rm -f "${FILE}.tmp"
    echo "[$(date -u)] ERROR: pg_dump falló." >&2
  fi

  if [ -d /uploads ] && [ -n "$(ls -A /uploads 2>/dev/null)" ]; then
    tar -czf "/backups/uploads-${STAMP}.tar.gz" -C /uploads . && echo "[$(date -u)] Fotos copiadas."
  fi

  find /backups -name 'pedifyai-*.dump' -mtime +"${KEEP_DAYS}" -delete
  find /backups -name 'uploads-*.tar.gz' -mtime +"${KEEP_DAYS}" -delete
  sleep "${INTERVAL}"
done
