#!/bin/bash
# Régénère les certificats FSOP sur le serveur Linux et redémarre le frontend.
# Usage :
#   cd docker
#   ./scripts/regenerate-fsop-ssl.sh
#   ./scripts/regenerate-fsop-ssl.sh 192.168.1.26

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"
SSL_RUNTIME="$DOCKER_DIR/ssl-runtime"
NGINX_SSL="$SSL_RUNTIME/nginx-ssl"
TABLET_SSL="$SSL_RUNTIME/tablet"

cd "$DOCKER_DIR"

# Lire uniquement SSL_EXTRA_IP (ne pas sourcer tout le .env : chemins avec espaces, etc.)
read_env_ssl_ip() {
    if [ -f ".env" ]; then
        grep -E '^SSL_EXTRA_IP=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '[:space:]"'"'"
    fi
}

SSL_EXTRA_IP="$(read_env_ssl_ip)"

IP="${1:-${SSL_EXTRA_IP:-}}"
if [ -z "$IP" ]; then
    IP="$(hostname -I | awk '{print $1}')"
fi

if [ -z "$IP" ]; then
    echo "ERREUR: impossible de déterminer l'IP. Passez-la en argument." >&2
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "ERREUR: openssl introuvable sur ce serveur." >&2
    exit 1
fi

echo "=== Régénération certificats FSOP ==="
echo "IP serveur : $IP"
echo "Sortie     : $SSL_RUNTIME"
echo ""

mkdir -p "$NGINX_SSL" "$TABLET_SSL"

SSL_DIR="$NGINX_SSL" \
WEB_SSL_DIR="$TABLET_SSL" \
SSL_EXTRA_IP="$IP" \
FORCE_REGEN=1 \
sh "$SCRIPT_DIR/generate-ssl-certs.sh"

# Sauvegarde lisible pour l'admin (hors git)
ADMIN_EXPORT="$SSL_RUNTIME/export-admin"
mkdir -p "$ADMIN_EXPORT"
cp "$NGINX_SSL/privkey.pem" "$ADMIN_EXPORT/fsop-server-privkey.pem"
cp "$NGINX_SSL/fullchain.pem" "$ADMIN_EXPORT/fsop-server-fullchain.pem"
cp "$TABLET_SSL/SEDI-ATI-CA.crt" "$ADMIN_EXPORT/SEDI-ATI-CA.crt"
cp "$TABLET_SSL/SEDI-ATI-CA.cer" "$ADMIN_EXPORT/SEDI-ATI-CA.cer"
chmod 600 "$ADMIN_EXPORT/fsop-server-privkey.pem"
chmod 644 "$ADMIN_EXPORT"/*.crt "$ADMIN_EXPORT"/*.cer "$ADMIN_EXPORT"/*.pem 2>/dev/null || true

# Mettre à jour .env (une seule ligne SSL_EXTRA_IP)
if grep -q '^SSL_EXTRA_IP=' .env 2>/dev/null; then
    sed -i "s/^SSL_EXTRA_IP=.*/SSL_EXTRA_IP=${IP}/" .env
else
    echo "SSL_EXTRA_IP=${IP}" >> .env
fi

echo ""
echo "=== Redémarrage frontend avec les nouveaux certificats ==="
docker compose -f docker-compose.production.yml up -d --force-recreate frontend

echo ""
echo "=== Vérifications ==="
curl -s -o /dev/null -w "HTTP  SEDI-ATI-CA.crt : %{http_code}\n" "http://localhost/ssl/SEDI-ATI-CA.crt"
curl -s -o /dev/null -w "HTTP  SEDI-ATI-CA.cer  : %{http_code}\n" "http://localhost/ssl/SEDI-ATI-CA.cer"
curl -k -s -o /dev/null -w "HTTPS application    : %{http_code}\n" "https://localhost/"

echo ""
echo "=== Terminé ==="
echo "Tablettes : http://${IP}/install-cert.html"
echo "App       : https://${IP}"
echo ""
echo "Fichiers admin (serveur uniquement) :"
echo "  $ADMIN_EXPORT/fsop-server-privkey.pem   (clé privée — NE PAS mettre sur tablette)"
echo "  $ADMIN_EXPORT/fsop-server-fullchain.pem (certificat public serveur)"
echo "  $ADMIN_EXPORT/SEDI-ATI-CA.crt           (certificat public CA — tablettes)"
echo "  $ADMIN_EXPORT/SEDI-ATI-CA.cer           (certificat public CA — tablettes Android)"
