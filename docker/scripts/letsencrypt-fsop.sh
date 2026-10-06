#!/bin/bash
# Certificat HTTPS public Let's Encrypt pour fsop.sedi-ati.com (validation DNS-01 via Gandi LiveDNS).
# Reconnu par tous les navigateurs : plus besoin d'installer la CA SEDI-ATI sur les postes.
#
# Prérequis (docker/.env) :
#   GANDI_LIVEDNS_TOKEN=...   Jeton d'accès personnel Gandi (droit "Gérer la configuration DNS" sur sedi-ati.com)
#   LETSENCRYPT_EMAIL=...     (optionnel) e-mail d'alerte d'expiration
#   LETSENCRYPT_DOMAIN=...    (optionnel, défaut fsop.sedi-ati.com)
#
# Usage :
#   cd docker
#   ./scripts/letsencrypt-fsop.sh                  # 1re émission + installation dans Nginx
#   ./scripts/letsencrypt-fsop.sh renew            # renouvellement (si < 30 jours restants) + reload Nginx
#   sudo ./scripts/letsencrypt-fsop.sh install-timer  # renouvellement automatique quotidien (systemd)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SSL_RUNTIME="$DOCKER_DIR/ssl-runtime"
NGINX_SSL="$SSL_RUNTIME/nginx-ssl"
ACME_HOME="$SSL_RUNTIME/acme"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-sedi-tablette-frontend}"
ACME_IMAGE="${ACME_IMAGE:-neilpang/acme.sh:latest}"

cd "$DOCKER_DIR"

# Lecture ciblée de docker/.env (ne pas sourcer : chemins avec espaces, etc.)
read_env() {
    if [ -f ".env" ]; then
        grep -E "^$1=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' | tr -d '\r'
    fi
}

GANDI_LIVEDNS_TOKEN="${GANDI_LIVEDNS_TOKEN:-$(read_env GANDI_LIVEDNS_TOKEN)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(read_env LETSENCRYPT_EMAIL)}"
DOMAIN="${LETSENCRYPT_DOMAIN:-$(read_env LETSENCRYPT_DOMAIN)}"
DOMAIN="${DOMAIN:-fsop.sedi-ati.com}"

MODE="${1:-issue}"

acme() {
    docker run --rm \
        -v "$ACME_HOME:/acme.sh" \
        -v "$NGINX_SSL:/out" \
        -e GANDI_LIVEDNS_TOKEN="$GANDI_LIVEDNS_TOKEN" \
        "$ACME_IMAGE" "$@"
}

install_cert_files() {
    acme --install-cert -d "$DOMAIN" \
        --key-file /out/privkey.pem \
        --fullchain-file /out/fullchain.pem
    chmod 600 "$NGINX_SSL/privkey.pem"
    chmod 644 "$NGINX_SSL/fullchain.pem"
}

reload_nginx() {
    if docker ps --format '{{.Names}}' | grep -qx "$FRONTEND_CONTAINER"; then
        docker exec "$FRONTEND_CONTAINER" nginx -t
        docker exec "$FRONTEND_CONTAINER" nginx -s reload
        echo "Nginx rechargé ($FRONTEND_CONTAINER)"
    else
        echo "WARN: conteneur $FRONTEND_CONTAINER non démarré — certificat pris en compte au prochain démarrage" >&2
    fi
}

fingerprint() {
    sha256sum "$NGINX_SSL/fullchain.pem" 2>/dev/null | awk '{print $1}'
}

require_token() {
    if [ -z "$GANDI_LIVEDNS_TOKEN" ]; then
        echo "ERREUR: GANDI_LIVEDNS_TOKEN absent de docker/.env" >&2
        echo "  Gandi > Paramètres du compte > Jetons d'accès personnel > Créer (droit : Gérer la configuration DNS)" >&2
        exit 1
    fi
}

case "$MODE" in
    issue)
        require_token
        mkdir -p "$ACME_HOME" "$NGINX_SSL"

        # Sauvegarde du certificat auto-signé actuel (retour arrière possible)
        if [ -f "$NGINX_SSL/fullchain.pem" ] && [ ! -d "$NGINX_SSL/selfsigned-backup" ]; then
            mkdir -p "$NGINX_SSL/selfsigned-backup"
            cp -a "$NGINX_SSL/fullchain.pem" "$NGINX_SSL/privkey.pem" "$NGINX_SSL/selfsigned-backup/" 2>/dev/null || true
            echo "Ancien certificat sauvegardé dans $NGINX_SSL/selfsigned-backup/"
        fi

        if [ -n "$LETSENCRYPT_EMAIL" ]; then
            acme --register-account -m "$LETSENCRYPT_EMAIL" --server letsencrypt || true
        fi

        echo "=== Émission Let's Encrypt pour $DOMAIN (DNS-01 Gandi) ==="
        acme --issue --server letsencrypt --dns dns_gandi_livedns \
            -d "$DOMAIN" --keylength 2048 || {
            rc=$?
            # 2 = certificat déjà valide, pas besoin de le réémettre
            [ "$rc" -eq 2 ] || exit "$rc"
        }

        install_cert_files
        reload_nginx

        echo ""
        echo "=== Terminé ==="
        openssl x509 -in "$NGINX_SSL/fullchain.pem" -noout -subject -issuer -enddate
        echo "Accès : https://$DOMAIN"
        echo "Renouvellement auto : sudo ./scripts/letsencrypt-fsop.sh install-timer"
        ;;

    renew)
        require_token
        before="$(fingerprint)"
        acme --cron
        install_cert_files
        after="$(fingerprint)"
        if [ "$before" != "$after" ]; then
            echo "Certificat renouvelé"
            reload_nginx
        else
            echo "Certificat encore valide, rien à faire"
        fi
        ;;

    install-timer)
        if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
            echo "Exécuter en root: sudo $0 install-timer" >&2
            exit 1
        fi
        FSOP_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"
        for f in sedi-letsencrypt.service sedi-letsencrypt.timer; do
            sed "s|/home/Tablette-FSOP|${FSOP_ROOT}|g" "$DOCKER_DIR/systemd/$f" >"/etc/systemd/system/$f"
            echo "  → /etc/systemd/system/$f"
        done
        systemctl daemon-reload
        systemctl enable --now sedi-letsencrypt.timer
        systemctl list-timers --no-pager 'sedi-letsencrypt*' || true
        ;;

    *)
        echo "Usage: $0 [issue|renew|install-timer]" >&2
        exit 1
        ;;
esac
