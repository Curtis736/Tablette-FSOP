#!/bin/sh
# Génère une autorité de certification locale SEDI-ATI + certificat serveur (10 ans).
# Usage (dans l'image Docker ou sur une machine avec openssl) :
#   ./generate-ssl-certs.sh
#   SSL_EXTRA_IP=192.168.1.50 ./generate-ssl-certs.sh

set -e

SSL_DIR="${SSL_DIR:-/etc/nginx/ssl}"
WEB_SSL_DIR="${WEB_SSL_DIR:-/usr/share/nginx/html/ssl}"
DAYS_CA="${DAYS_CA:-3650}"
DAYS_SERVER="${DAYS_SERVER:-3650}"
CN="${SSL_CN:-fsop.sedi-ati.com}"
EXTRA_IP="${SSL_EXTRA_IP:-}"

mkdir -p "$SSL_DIR" "$WEB_SSL_DIR"

# Autorité de certification locale
if [ ! -f "$SSL_DIR/ca.key" ]; then
    openssl genrsa -out "$SSL_DIR/ca.key" 2048
fi

openssl req -x509 -new -nodes -key "$SSL_DIR/ca.key" -sha256 -days "$DAYS_CA" \
    -out "$SSL_DIR/ca.crt" \
    -subj "/C=FR/O=SEDI-ATI/CN=SEDI-ATI Local CA"

EXTRA_IP="$(echo "$EXTRA_IP" | tr -d '[:space:]')"

# Config OpenSSL avec noms alternatifs (local + domaine)
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

# Certificat CA à installer sur les tablettes Android
cp "$SSL_DIR/ca.crt" "$WEB_SSL_DIR/SEDI-ATI-CA.crt"
chmod 644 "$WEB_SSL_DIR/SEDI-ATI-CA.crt"

echo "Certificats générés dans ${SSL_DIR}"
echo "CA tablette : ${WEB_SSL_DIR}/SEDI-ATI-CA.crt"
echo "SAN : ${SAN}"
