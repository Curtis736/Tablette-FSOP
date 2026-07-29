#!/usr/bin/env bash
# Restaure une sauvegarde créée par backup-fsop.sh
# Usage: ./restore-fsop.sh /var/backups/tablette-fsop/YYYYMMDD_HHMMSS
# ATTENTION: écrase .env / volume redis / ssl-runtime — à confirmer.

set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "Usage: $0 /chemin/vers/sauvegarde"
  exit 1
fi

ROOT="${FSOP_ROOT:-/home/Tablette-FSOP}"
ENV_FILE="${FSOP_ENV_FILE:-$ROOT/docker/.env}"
VOL_REDIS="${REDIS_VOLUME_NAME:-sedi-tablette-redis-data}"

echo "[RESTORE] Source: $SRC"
echo "[RESTORE] Ceci va écraser config/volume. Ctrl+C dans 5s pour annuler..."
sleep 5

if [[ -f "$SRC/docker.env" ]]; then
  cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
  cp -a "$SRC/docker.env" "$ENV_FILE"
  echo "[RESTORE] docker/.env OK"
fi

if [[ -f "$SRC/ssl-runtime.tgz" ]]; then
  mkdir -p "$ROOT/docker"
  tar -C "$ROOT/docker" -xzf "$SRC/ssl-runtime.tgz"
  echo "[RESTORE] ssl-runtime OK"
fi

if [[ -f "$SRC/redis-data.tgz" ]]; then
  echo "[RESTORE] Arrêt redis..."
  docker stop sedi-tablette-redis 2>/dev/null || true
  docker run --rm \
    -v "$VOL_REDIS:/data" \
    -v "$SRC:/backup:ro" \
    alpine:3.20 \
    sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; tar -xzf /backup/redis-data.tgz -C /data'
  docker start sedi-tablette-redis 2>/dev/null || true
  echo "[RESTORE] volume redis OK"
fi

echo "[RESTORE] DONE — redémarrer si besoin:"
echo "  cd $ROOT/docker && docker compose --env-file .env -f docker-compose.production.yml up -d"
