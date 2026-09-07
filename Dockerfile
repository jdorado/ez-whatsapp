FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY package.json ./
COPY docker/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
FROM dependencies AS test
RUN pnpm verify
FROM dependencies AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /state/whatsapp /plugins/whatsapp /client/bin /client/src && chown -R node:node /state/whatsapp /plugins/whatsapp /client && cp bin/ez-whatsapp.mjs /client/bin/ez-whatsapp && cp bin/ez-whatsapp.mjs /client/bin/ez-whatsapp.mjs && cp ez-plugin.json /client/ && cp src/cli.mjs src/client.mjs src/store.mjs /client/src/ && cp -r skills /client/ && chmod +x /client/bin/ez-whatsapp docker/*.sh && chown -R node:node /client
ENV EZ_WHATSAPP_QR_PATH=/plugins/whatsapp/pairing.png
USER node
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["serve", "--profile", "/state/whatsapp", "--socket", "/plugins/whatsapp/service.sock"]
