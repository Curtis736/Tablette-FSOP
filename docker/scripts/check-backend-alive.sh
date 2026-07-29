#!/usr/bin/env bash
# Vérifie que le backend FSOP répond. Alerte Teams si KO.
# Destiné à tourner sur l'hôte (systemd timer / cron) — le backend ne peut pas s'alerter s'il est down.

set -euo pipefail

ROOT="${FSOP_ROOT:-/home/Tablette-FSOP}"
ENV_FILE="${FSOP_ENV_FILE:-$ROOT/docker/.env}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
# Via nginx si le port backend n'est pas exposé :
# HEALTH_URL=https://127.0.0.1/api/health  (ou http://127.0.0.1/api/health)
LOG_DIR="${LOG_DIR:-/var/log}"
ALERT_LOG="${ALERT_LOG:-$LOG_DIR/sedi-watchdog-alert.log}"
STATE_FILE="${STATE_FILE:-/var/tmp/sedi-backend-health.state}"
COOLDOWN_SEC="${ALERT_COOLDOWN_SECONDS:-3600}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

TEAMS_URL="${TEAMS_WEBHOOK_URL:-${ALERT_TEAMS_WEBHOOK:-}}"
TS="$(date -Iseconds)"

log() { echo "[$TS] $*" | tee -a "$ALERT_LOG" 2>/dev/null || echo "[$TS] $*"; }

container_ok=0
if docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -qE '^sedi-tablette-backend .*Up'; then
  container_ok=1
fi

http_ok=0
# Essayer localhost:3001 puis via le réseau docker (backend non publié)
if curl -fsS --max-time 8 "$HEALTH_URL" >/dev/null 2>&1; then
  http_ok=1
elif docker exec sedi-tablette-backend curl -fsS --max-time 8 http://localhost:3001/api/health >/dev/null 2>&1; then
  http_ok=1
elif curl -fsSk --max-time 8 "https://127.0.0.1/api/health" >/dev/null 2>&1; then
  http_ok=1
elif curl -fsS --max-time 8 "http://127.0.0.1/api/health" >/dev/null 2>&1; then
  http_ok=1
fi

if [[ "$container_ok" -eq 1 && "$http_ok" -eq 1 ]]; then
  echo ok >"$STATE_FILE" 2>/dev/null || true
  log "BACKEND_OK container=up health=ok"
  exit 0
fi

# Cooldown anti-spam
LAST=0
if [[ -f "$STATE_FILE" ]]; then
  LAST="$(stat -c %Y "$STATE_FILE" 2>/dev/null || echo 0)"
fi
NOW="$(date +%s)"
SHOULD_ALERT=1
if [[ -f "$STATE_FILE" ]] && grep -q fail "$STATE_FILE" 2>/dev/null; then
  if (( NOW - LAST < COOLDOWN_SEC )); then
    SHOULD_ALERT=0
  fi
fi

echo "fail $TS container=$container_ok health=$http_ok" >"$STATE_FILE" 2>/dev/null || true
MSG="Backend FSOP KO à $TS — container_up=$container_ok health_ok=$http_ok. Vérifier: docker ps ; docker logs sedi-tablette-backend"
log "BACKEND_DOWN $MSG"

if [[ "$SHOULD_ALERT" -eq 1 && -n "$TEAMS_URL" ]]; then
  payload=$(printf '{"@type":"MessageCard","@context":"http://schema.org/extensions","themeColor":"FF0000","summary":"Backend FSOP KO","title":"[FSOP] Backend down","text":"%s"}' "$MSG")
  curl -fsS -H 'Content-Type: application/json' -d "$payload" "$TEAMS_URL" >/dev/null 2>&1 \
    && log "TEAMS_ALERT_SENT" \
    || log "TEAMS_ALERT_FAILED"
elif [[ -z "$TEAMS_URL" ]]; then
  log "TEAMS_WEBHOOK_URL non défini — alerte log only"
fi

exit 1
