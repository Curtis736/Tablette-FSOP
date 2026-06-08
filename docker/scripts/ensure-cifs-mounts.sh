#!/usr/bin/env bash
set -euo pipefail

# Ensure critical CIFS mounts are present on the host.
# Mount roots come from fstab; template paths may be subdirectories (not mount points).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/docker/.env}"

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

is_accessible() {
  local p="$1"
  [[ -n "$p" ]] && [[ -d "$p" ]] && [[ -r "$p" ]]
}

main() {
  load_docker_env

  local need_remount=0 mp
  for mp in "${FSTAB_MOUNT_POINTS[@]}"; do
    if ! is_mounted "$mp"; then
      log "Mount point missing: $mp"
      need_remount=1
    fi
  done

  if [[ "$need_remount" -eq 1 ]]; then
    log "Attempting to remount using fstab (mount -a)..."
    mount -a || true
  fi

  local failed=0
  for mp in "${FSTAB_MOUNT_POINTS[@]}"; do
    if ! is_mounted "$mp"; then
      log "Still not mounted: $mp"
      failed=1
    fi
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
  exit 1
}

main "$@"
