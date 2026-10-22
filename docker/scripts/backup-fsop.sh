#!/usr/bin/env bash
# Sauvegarde volumes Docker FSOP + fichiers de config (.env, ssl).
# Usage: ./backup-fsop.sh [répertoire_destination]

set -euo pipefail

ROOT="${FSOP_ROOT:-/home/Tablette-FSOP}"
ENV_FILE="${FSOP_ENV_FILE:-$ROOT/docker/.env}"
DEST_ROOT="${1:-${FSOP_BACKUP_DIR:-/var/backups/tablette-fsop}}"
STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$DEST_ROOT/$STAMP"
KEEP_DAYS="${FSOP_BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DEST"
echo "[BACKUP] Dest: $DEST"

# 1) Config
if [[ -f "$ENV_FILE" ]]; then
  cp -a "$ENV_FILE" "$DEST/docker.env"
  echo "[BACKUP] docker/.env OK"
else
  echo "[BACKUP][WARN] $ENV_FILE introuvable"
fi

if [[ -d "$ROOT/docker/ssl-runtime" ]]; then
  tar -C "$ROOT/docker" -czf "$DEST/ssl-runtime.tgz" ssl-runtime
  echo "[BACKUP] ssl-runtime OK"
fi

# 2) Volume Redis (nom compose production)
VOL_REDIS="${REDIS_VOLUME_NAME:-sedi-tablette-redis-data}"
if docker volume inspect "$VOL_REDIS" >/dev/null 2>&1; then
  docker run --rm \
    -v "$VOL_REDIS:/data:ro" \
    -v "$DEST:/backup" \
    alpine:3.20 \
    tar -czf /backup/redis-data.tgz -C /data .
  echo "[BACKUP] volume $VOL_REDIS OK"
else
  echo "[BACKUP][WARN] volume $VOL_REDIS absent"
fi

# 3) Logs backend (optionnel)
if [[ -d "$ROOT/backend/logs" ]]; then
  tar -C "$ROOT/backend" -czf "$DEST/backend-logs.tgz" logs || true
fi

# 4) Manifest
{
  echo "stamp=$STAMP"
  echo "host=$(hostname)"
  echo "created=$(date -Iseconds)"
  docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null || true
} >"$DEST/MANIFEST.txt"

# Rétention
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[BACKUP] DONE $DEST"
echo "$DEST"
