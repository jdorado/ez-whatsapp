#!/bin/sh
set -eu
umask 077
if [ "${1:-}" = serve ]; then
  exec flock --no-fork -n -E 73 /state/whatsapp/container.lock /app/docker/serve.sh "$@"
fi
exec node /app/bin/ez-whatsapp.mjs "$@"
