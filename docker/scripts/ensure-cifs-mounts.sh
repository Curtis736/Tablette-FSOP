#!/usr/bin/env bash
set -euo pipefail

# Ensure critical CIFS mounts are present on the host.
# If the SMB mounts are lost (common after network hiccups), Docker bind-mounts
# may fail and the backend container can exit. This script remounts using fstab.

TARGETS_DEFAULT=(
  "/mnt/partage_fsop"                 # services/tracabilite -> /mnt/services/Tracabilite
  "/mnt/templates"                    # templates root mapped to /mnt/templates (common)
  "/mnt/partage_services/Services"  # alternative templates mapping (see env.vm.example)
)

SERVICES_HOST_PATH="${SERVICES_HOST_PATH:-/mnt/partage_fsop}"
TEMPLATES_HOST_PATH="${TEMPLATES_HOST_PATH:-/mnt/templates}"

TARGETS=(
  "$SERVICES_HOST_PATH"
  "$TEMPLATES_HOST_PATH"
  "/mnt/partage_services/Services"
)

log() {
  echo "[ensure-cifs-mounts] $(date -Is) $*"
}

is_mounted() {
  local p="$1"
  # mountpoint(1) returns 0 when mounted
  command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$p" && return 0
  # Fallback: check /proc/mounts
  grep -qsE "[[:space:]]$p[[:space:]]" /proc/mounts
}

main() {
  local missing=0
  for p in "${TARGETS[@]}"; do
    if [[ -z "${p}" ]]; then
      continue
    fi
    # If directory doesn't exist, create it so mount can succeed.
    mkdir -p "$p" || true
    if ! is_mounted "$p"; then
      log "Mount missing: $p"
      missing=1
    fi
  done

  if [[ "$missing" -eq 0 ]]; then
    log "All CIFS targets look mounted."
    exit 0
  fi

  log "Attempting to remount using fstab (mount -a)..."
  # mount -a relies on /etc/fstab entries. Run as root via systemd.
  mount -a || true

  missing=0
  for p in "${TARGETS[@]}"; do
    if [[ -z "${p}" ]]; then
      continue
    fi
    if ! is_mounted "$p"; then
      log "Still missing after mount -a: $p"
      missing=1
    fi
  done

  if [[ "$missing" -eq 0 ]]; then
    log "CIFS mounts restored."
    exit 0
  fi

  log "CIFS mounts NOT restored yet."
  exit 1
}

main "$@"

