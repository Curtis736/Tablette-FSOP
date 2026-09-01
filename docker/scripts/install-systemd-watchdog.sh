#!/usr/bin/env bash
# Installe les timers systemd FSOP (health, CIFS, watchdog) sur serveurproduction.
# Usage: sudo ./docker/scripts/install-systemd-watchdog.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FSOP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYSTEMD_SRC="$FSOP_ROOT/docker/systemd"
SYSTEMD_DST="/etc/systemd/system"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Exécuter en root: sudo $0"
  exit 1
fi

install_unit() {
  local src="$1"
  local name
  name="$(basename "$src")"
  sed "s|/home/Tablette-FSOP|${FSOP_ROOT}|g" "$src" >"$SYSTEMD_DST/$name"
  echo "  → $SYSTEMD_DST/$name"
}

echo "FSOP_ROOT=$FSOP_ROOT"
chmod +x "$FSOP_ROOT/docker/scripts/check-backend-alive.sh" \
         "$FSOP_ROOT/docker/scripts/ensure-cifs-mounts.sh" \
         "$FSOP_ROOT/docker/scripts/run-proactive-watchdog.sh" \
         2>/dev/null || true

for f in \
  sedi-backend-health.service \
  sedi-backend-health.timer \
  sedi-cifs-ensure.service \
  sedi-cifs-ensure.timer \
  sedi-watchdog.service \
  sedi-watchdog.timer
do
  if [[ ! -f "$SYSTEMD_SRC/$f" ]]; then
    echo "Fichier manquant: $SYSTEMD_SRC/$f"
    exit 1
  fi
  install_unit "$SYSTEMD_SRC/$f"
done

systemctl daemon-reload
systemctl enable --now sedi-backend-health.timer
systemctl enable --now sedi-cifs-ensure.timer
systemctl enable --now sedi-watchdog.timer

echo ""
echo "Timers actifs:"
systemctl list-timers --no-pager 'sedi-*' || true
echo ""
echo "Test manuel:"
echo "  $FSOP_ROOT/docker/scripts/check-backend-alive.sh"
echo ""
echo "Optionnel dans docker/.env :"
echo "  TEAMS_WEBHOOK_URL=https://..."
echo "  AUTO_RESTART_BACKEND=true"
