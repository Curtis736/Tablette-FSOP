#!/usr/bin/env bash
set -euo pipefail

# Ensure critical CIFS mounts are present and usable on the host.
# - Remounts via fstab when missing
# - Forces remount when the mount point is present but stale / unreadable
# Mount roots come from fstab; template paths may be subdirectories (not mount points).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/docker/prod/.env}"

SERVICES_HOST_PATH="${SERVICES_HOST_PATH:-/mnt/partage_fsop}"
TEMPLATES_HOST_PATH="${TEMPLATES_HOST_PATH:-}"

# CIFS roots declared in /etc/fstab on serveurproduction (not subdirs like .../Services).
FSTAB_MOUNT_POINTS=(
  "/mnt/partage_fsop"
  "/mnt/partage_services"
)

log() {
  echo "[ensure-cifs-mounts] $(date -Is) $*"
}

load_docker_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  local key val
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line//$'\r'/}"
    [[ "$line" =~ ^(SERVICES_HOST_PATH|TEMPLATES_HOST_PATH)= ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    val="${val%\"}"
    val="${val#\"}"
    export "$key=$val"
  done < "$ENV_FILE"
}

is_mounted() {
  local p="$1"
  command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$p" && return 0
  grep -qsE "[[:space:]]$p[[:space:]]" /proc/mounts
}

# True if directory is readable within a short timeout (detects stale CIFS).
is_accessible() {
  local p="$1"
  [[ -n "$p" ]] || return 1
  timeout 5s bash -c "[[ -d \"$p\" && -r \"$p\" ]]" 2>/dev/null
}

force_remount() {
  local mp="$1"
  log "Force remount: $mp"
  # Lazy unmount if hung, then remount from fstab
  umount -l "$mp" 2>/dev/null || true
  mount "$mp" 2>/dev/null || mount -a || true
}

ensure_mount() {
  local mp="$1"
  if ! is_mounted "$mp"; then
    log "Mount point missing: $mp"
    mount "$mp" 2>/dev/null || mount -a || true
  elif ! is_accessible "$mp"; then
    log "Mount point stale / inaccessible: $mp"
    force_remount "$mp"
  else
    log "Mount OK: $mp"
    return 0
  fi

  if is_mounted "$mp" && is_accessible "$mp"; then
    log "Remounted OK: $mp"
    return 0
  fi
  log "Still failing: $mp"
  return 1
}

main() {
  load_docker_env

  local failed=0 mp
  for mp in "${FSTAB_MOUNT_POINTS[@]}"; do
    ensure_mount "$mp" || failed=1
  done

  local access_paths=("$SERVICES_HOST_PATH")
  if [[ -n "$TEMPLATES_HOST_PATH" ]]; then
    access_paths+=("$TEMPLATES_HOST_PATH")
  fi

  local ap
  for ap in "${access_paths[@]}"; do
    if is_accessible "$ap"; then
      log "Path accessible: $ap"
    else
      log "Path not accessible: $ap"
      failed=1
    fi
  done

  if [[ "$failed" -eq 0 ]]; then
    log "CIFS OK (mount points + docker bind sources)."
    exit 0
  fi

  log "CIFS check FAILED."
  notify_teams_cifs_failure
  exit 1
}

# Alerte Teams (hôte) si webhook présent — cooldown 60 min par défaut.
notify_teams_cifs_failure() {
  local webhook=""
  local cooldown_min="${CIFS_ALERT_COOLDOWN_MINUTES:-60}"
  local cooldown_file="${CIFS_ALERT_COOLDOWN_FILE:-/var/log/sedi-cifs-alert.cooldown}"
  local now epoch_last

  if [[ -f "$ENV_FILE" ]]; then
    webhook="$(grep -E '^(TEAMS_WEBHOOK_URL|ALERT_TEAMS_WEBHOOK)=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//;s/"$//')"
  fi
  webhook="${webhook:-${TEAMS_WEBHOOK_URL:-${ALERT_TEAMS_WEBHOOK:-}}}"
  [[ -n "$webhook" ]] || {
    log "Teams webhook absent — pas d'alerte CIFS distante."
    return 0
  }

  now="$(date +%s)"
  if [[ -f "$cooldown_file" ]]; then
    epoch_last="$(tr -d '[:space:]' <"$cooldown_file" 2>/dev/null || true)"
    if [[ "$epoch_last" =~ ^[0-9]+$ ]] && (( now - epoch_last < cooldown_min * 60 )); then
      log "Alerte CIFS en cooldown (${cooldown_min} min)."
      return 0
    fi
  fi

  local payload
  payload=$(cat <<EOF
{"@type":"MessageCard","@context":"http://schema.org/extensions","themeColor":"FF0000","summary":"CIFS FSOP","title":"[FSOP] Montages CIFS en échec","text":"ensure-cifs-mounts.sh a échoué sur $(hostname) à $(date -Is). Vérifier /mnt/partage_fsop et /mnt/partage_services (mount -a)."}
EOF
)
  if curl -fsS -X POST -H 'Content-Type: application/json' -d "$payload" "$webhook" >/dev/null; then
    echo "$now" >"$cooldown_file" 2>/dev/null || true
    log "Alerte Teams CIFS envoyée."
  else
    log "Échec envoi Teams CIFS."
  fi
}

main "$@"
