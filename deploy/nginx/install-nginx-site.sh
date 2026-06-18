#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SITE_NAME=zd-test-client
SITE_CONF=/etc/nginx/sites-available/$SITE_NAME.conf

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed. Install it first: apt-get update && apt-get install -y nginx" >&2
  exit 1
fi

mkdir -p /opt/zd-test-client/www
cp "$SCRIPT_DIR/zd-test-client-nginx.conf" "$SITE_CONF"
ln -sf "$SITE_CONF" /etc/nginx/sites-enabled/$SITE_NAME.conf
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "Installed nginx site: http://127.0.0.1:18088/"

