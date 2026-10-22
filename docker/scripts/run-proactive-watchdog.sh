#!/usr/bin/env bash
# Lance le watchdog Node dans le conteneur backend (alerte Teams/email si WARNING).

set -euo pipefail

ROOT="${FSOP_ROOT:-/home/Tablette-FSOP}"
LOG="${WATCHDOG_LOG:-/var/log/sedi-watchdog.log}"
TS="$(date -Iseconds)"

{
  echo "[$TS] START"
  docker exec sedi-tablette-backend node /app/scripts/proactive-watchdog.js
  echo "[$TS] OK"
} >>"$LOG" 2>&1
