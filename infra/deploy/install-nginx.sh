#!/usr/bin/env sh
set -eu

DOMAIN=arken.uixray.tech
APP=/home/uixray/apps/arken-space
AVAILABLE=/etc/nginx/sites-available/$DOMAIN
ENABLED=/etc/nginx/sites-enabled/$DOMAIN
WEBROOT=/var/www/certbot
NGINX_CONFIG=/etc/nginx/nginx.conf
BACKUP=/etc/nginx/nginx.conf.arken-backup

sudo -n mkdir -p "$WEBROOT"

if ! sudo -n grep -q "^[[:space:]]*$DOMAIN[[:space:]]\+127\.0\.0\.1:4430;" "$NGINX_CONFIG"; then
  sudo -n cp "$NGINX_CONFIG" "$BACKUP"
  sudo -n sed -i "/map \\$ssl_preread_server_name \\$backend {/a\\        $DOMAIN 127.0.0.1:4430;" "$NGINX_CONFIG"
fi

cat > /tmp/arken-http.conf <<EOF
server {
  listen 80;
  server_name $DOMAIN;

  location ^~ /.well-known/acme-challenge/ {
    root $WEBROOT;
    default_type text/plain;
  }

  location / {
    return 503;
  }
}
EOF

sudo -n cp /tmp/arken-http.conf "$AVAILABLE"
sudo -n ln -sfn "$AVAILABLE" "$ENABLED"

if ! sudo -n nginx -t; then
  if [ -f "$BACKUP" ]; then sudo -n cp "$BACKUP" "$NGINX_CONFIG"; fi
  exit 1
fi
sudo -n systemctl reload nginx

sudo -n certbot certonly \
  --webroot \
  --webroot-path "$WEBROOT" \
  --domain "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --register-unsafely-without-email

sudo -n cp "$APP/infra/nginx/arken.uixray.tech.conf" "$AVAILABLE"
sudo -n nginx -t
sudo -n systemctl reload nginx

echo "nginx-ready $DOMAIN"
