#!/usr/bin/env bash
# Build + déploiement environnement TEST FSOP (jamais la prod).
# Usage:
#   ./docker/scripts/deploy-test.sh
# Variables:
#   FSOP_ROOT          (défaut: répertoire parent de docker/)
#   COMPOSE_PROJECT    (défaut: sedi-tablette-test)
#   ENV_FILE           (défaut: docker/.env.test)
#   SKIP_BUILD=1       saute le rebuild images
#   SMOKE_URL          URL health (défaut http://127.0.0.1:8088/api/health)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT="$(cd "${DOCKER_DIR}/.." && pwd)"
FSOP_ROOT="${FSOP_ROOT:-$ROOT}"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.test.yml"
ENV_FILE="${ENV_FILE:-${DOCKER_DIR}/.env.test}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-sedi-tablette-test}"
NETWORK_NAME="${TEST_NETWORK_NAME:-sedi-tablette-test-network}"
SMOKE_URL="${SMOKE_URL:-http://127.0.0.1:8088/api/health}"

log() { printf '[deploy-test] %s\n' "$*"; }

if [[ ! -f "$COMPOSE_FILE" ]]; then
  log "ERREUR: $COMPOSE_FILE introuvable"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERREUR: $ENV_FILE manquant — copier docker/.env.test.example vers docker/.env.test"
  exit 1
fi

cd "$FSOP_ROOT"

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  log "Création réseau $NETWORK_NAME"
  docker network create "$NETWORK_NAME"
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  log "Build images :test"
  docker build -t docker-sedi-backend:test -f docker/Dockerfile.backend .
  docker build -t docker-sedi-frontend:test -f docker/Dockerfile.frontend .
fi

log "Compose up ($COMPOSE_PROJECT)"
mkdir -p "${DOCKER_DIR}/ssl-runtime-test/nginx-ssl" "${DOCKER_DIR}/ssl-runtime-test/tablet" "${FSOP_ROOT}/backend/logs-test"
if [[ ! -f "${DOCKER_DIR}/ssl-runtime-test/nginx-ssl/fullchain.pem" && -d "${DOCKER_DIR}/ssl-runtime/nginx-ssl" ]]; then
  cp -a "${DOCKER_DIR}/ssl-runtime/nginx-ssl/." "${DOCKER_DIR}/ssl-runtime-test/nginx-ssl/" 2>/dev/null || true
  cp -a "${DOCKER_DIR}/ssl-runtime/tablet/." "${DOCKER_DIR}/ssl-runtime-test/tablet/" 2>/dev/null || true
fi

docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans

log "Attente health backend..."
for i in $(seq 1 40); do
  if curl -fsS --max-time 5 "$SMOKE_URL" >/dev/null 2>&1; then
    log "SMOKE OK $SMOKE_URL"
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    exit 0
  fi
  # Fallback via docker exec si nginx path différent
  if docker exec sedi-tablette-test-backend curl -fsS --max-time 5 http://localhost:3001/api/health >/dev/null 2>&1; then
    log "SMOKE OK (via container backend)"
    exit 0
  fi
  sleep 3
done

log "SMOKE FAILED après timeout ($SMOKE_URL)"
docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 80 backend || true
exit 1
