FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY package.json pnpm-workspace.yaml ./
COPY docker/pnpm-lock.yaml ./pnpm-lock.yaml
COPY patches ./patches
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --chown=node:node . .
FROM dependencies AS test
RUN pnpm verify
FROM dependencies AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates util-linux && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /state/whatsapp /plugins/whatsapp /client/bin /client/src && chown -R node:node /state/whatsapp /plugins/whatsapp /client && cp bin/ez-whatsapp.mjs /client/bin/ez-whatsapp && cp bin/ez-whatsapp.mjs /client/bin/ez-whatsapp.mjs && cp ez-plugin.json /client/ && cp src/cli.mjs src/client.mjs src/store.mjs /client/src/ && cp -r skills /client/ && chmod +x /client/bin/ez-whatsapp docker/*.sh && chown -R node:node /client
ENV EZ_WHATSAPP_QR_PATH=/plugins/whatsapp/pairing.png
USER node
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["serve", "--profile", "/state/whatsapp", "--socket", "/plugins/whatsapp/service.sock"]
