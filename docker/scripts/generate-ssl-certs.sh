#!/bin/sh
# Génère une PKI locale SEDI-ATI pour FSOP (CA + certificat serveur Nginx).
#
# Deux paires distinctes (c'est normal qu'elles ne correspondent pas entre elles) :
#   - CA      : ca.key (privée, serveur)  <->  ca.crt / SEDI-ATI-CA.crt|.cer (publique, tablettes)
#   - Serveur : privkey.pem (privée)      <->  fullchain.pem (publique, Nginx HTTPS)
#
# Usage :
#   SSL_EXTRA_IP=192.168.1.26 ./generate-ssl-certs.sh
#   SSL_DIR=./ssl-runtime/nginx-ssl WEB_SSL_DIR=./ssl-runtime/tablet SSL_EXTRA_IP=... ./generate-ssl-certs.sh

set -e

SSL_DIR="${SSL_DIR:-/etc/nginx/ssl}"
WEB_SSL_DIR="${WEB_SSL_DIR:-/usr/share/nginx/html/ssl}"
DAYS_CA="${DAYS_CA:-3650}"
DAYS_SERVER="${DAYS_SERVER:-3650}"
CN="${SSL_CN:-fsop.sedi-ati.com}"
EXTRA_IP="${SSL_EXTRA_IP:-}"
FORCE_REGEN="${FORCE_REGEN:-1}"

mkdir -p "$SSL_DIR" "$WEB_SSL_DIR"

if [ "$FORCE_REGEN" = "1" ]; then
    rm -f "$SSL_DIR"/*.pem "$SSL_DIR"/*.crt "$SSL_DIR"/*.csr "$SSL_DIR"/*.srl "$SSL_DIR"/*.cnf 2>/dev/null || true
    rm -f "$WEB_SSL_DIR"/SEDI-ATI-CA.crt "$WEB_SSL_DIR"/SEDI-ATI-CA.cer 2>/dev/null || true
fi

verify_key_cert_pair() {
    _key="$1"
    _cert="$2"
    _label="$3"
    _mod_key=$(openssl rsa -noout -modulus -in "$_key" 2>/dev/null | openssl md5)
    _mod_cert=$(openssl x509 -noout -modulus -in "$_cert" | openssl md5)
    if [ "$_mod_key" != "$_mod_cert" ]; then
        echo "ERREUR: clé privée et certificat public ne correspondent pas ($_label)" >&2
        exit 1
    fi
    echo "OK: paire $_label vérifiée"
}

verify_ca_signed_server() {
    if ! openssl verify -CAfile "$SSL_DIR/ca.crt" "$SSL_DIR/fullchain.pem" >/dev/null 2>&1; then
        echo "ERREUR: fullchain.pem n'est pas signé par ca.crt" >&2
        exit 1
    fi
    echo "OK: certificat serveur signé par la CA locale"
}

EXTRA_IP="$(echo "$EXTRA_IP" | tr -d '[:space:]')"

# --- Autorité de certification locale ---
openssl genrsa -out "$SSL_DIR/ca.key" 2048
openssl req -x509 -new -nodes -key "$SSL_DIR/ca.key" -sha256 -days "$DAYS_CA" \
    -out "$SSL_DIR/ca.crt" \
    -subj "/C=FR/O=SEDI-ATI/CN=SEDI-ATI Local CA"

# --- Certificat serveur FSOP ---
SAN="DNS:${CN},DNS:localhost,DNS:*.local,IP:127.0.0.1"
if [ -n "$EXTRA_IP" ]; then
    if echo "$EXTRA_IP" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        SAN="${SAN},IP:${EXTRA_IP}"
    else
        echo "WARN: SSL_EXTRA_IP ignoré (adresse IPv4 invalide): ${EXTRA_IP}" >&2
    fi
fi

cat > "$SSL_DIR/server-openssl.cnf" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C = FR
O = SEDI-ATI
CN = ${CN}

[req_ext]
subjectAltName = ${SAN}

[v3_ext]
subjectAltName = ${SAN}
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
EOF

openssl genrsa -out "$SSL_DIR/privkey.pem" 2048
openssl req -new -key "$SSL_DIR/privkey.pem" -out "$SSL_DIR/server.csr" -config "$SSL_DIR/server-openssl.cnf"
openssl x509 -req -in "$SSL_DIR/server.csr" -CA "$SSL_DIR/ca.crt" -CAkey "$SSL_DIR/ca.key" \
    -CAcreateserial -out "$SSL_DIR/fullchain.pem" -days "$DAYS_SERVER" -sha256 \
    -extensions v3_ext -extfile "$SSL_DIR/server-openssl.cnf"

chmod 600 "$SSL_DIR/privkey.pem" "$SSL_DIR/ca.key"
chmod 644 "$SSL_DIR/fullchain.pem" "$SSL_DIR/ca.crt"

# --- Exports tablettes (certificat PUBLIC de la CA uniquement) ---
cp "$SSL_DIR/ca.crt" "$WEB_SSL_DIR/SEDI-ATI-CA.crt"
openssl x509 -in "$SSL_DIR/ca.crt" -outform DER -out "$WEB_SSL_DIR/SEDI-ATI-CA.cer"
chmod 644 "$WEB_SSL_DIR/SEDI-ATI-CA.crt" "$WEB_SSL_DIR/SEDI-ATI-CA.cer"

# --- Vérifications ---
verify_key_cert_pair "$SSL_DIR/ca.key" "$SSL_DIR/ca.crt" "CA"
verify_key_cert_pair "$SSL_DIR/privkey.pem" "$SSL_DIR/fullchain.pem" "serveur Nginx"
verify_ca_signed_server

cat > "$WEB_SSL_DIR/README.txt" <<EOF
Certificats tablettes SEDI-ATI FSOP
=================================

Installer sur chaque tablette Android (UNE FOIS) :
  - SEDI-ATI-CA.crt  (format PEM)
  - SEDI-ATI-CA.cer  (format DER, même contenu)

Paramètres > Sécurité > Installer un certificat > Certificat CA

NE PAS installer sur les tablettes :
  - privkey.pem (clé privée serveur)
  - fullchain.pem (certificat serveur — géré par Nginx)
  - ca.key (clé privée CA — reste sur le serveur)

Accès application : https://${EXTRA_IP:-fsop.sedi-ati.com}
SAN : ${SAN}
Généré le : $(date -u '+%Y-%m-%d %H:%M:%S UTC')
EOF

echo ""
echo "=== Certificats FSOP générés ==="
echo "Serveur Nginx (Linux) :"
echo "  Clé privée  : ${SSL_DIR}/privkey.pem"
echo "  Certificat  : ${SSL_DIR}/fullchain.pem"
echo "Tablettes (certificat PUBLIC CA uniquement) :"
echo "  PEM         : ${WEB_SSL_DIR}/SEDI-ATI-CA.crt"
echo "  CER         : ${WEB_SSL_DIR}/SEDI-ATI-CA.cer"
echo "SAN           : ${SAN}"
