#!/bin/sh
set -eu
umask 077
  # Refresh the dependency-free client from this pinned image on each upgrade.
  for file in cli.mjs client.mjs store.mjs; do
    cp "/app/src/$file" "/client/src/$file.tmp"
    mv "/client/src/$file.tmp" "/client/src/$file"
  done
  cp /app/bin/ez-whatsapp.mjs /client/bin/ez-whatsapp.tmp
  chmod +x /client/bin/ez-whatsapp.tmp
  mv /client/bin/ez-whatsapp.tmp /client/bin/ez-whatsapp
  cp /app/bin/ez-whatsapp.mjs /client/bin/ez-whatsapp.mjs
  cp /app/ez-plugin.json /client/ez-plugin.json
  cp /app/skills/whatsapp/SKILL.md /client/skills/whatsapp/SKILL.md
# Only the kernel lock holder may clear a stale JSON lock after a crash.
rm -f /state/whatsapp/writer.lock
exec node /app/bin/ez-whatsapp.mjs "$@"
