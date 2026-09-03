#!/bin/sh
set -eu

# Certbot deploy hook: only load a renewed certificate after nginx validates.
/usr/sbin/nginx -t
/bin/systemctl reload nginx
