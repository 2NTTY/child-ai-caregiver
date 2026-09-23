FROM node:24.19.0-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS web-build

ENV CI=1 \
    EXPO_NO_TELEMETRY=1 \
    EXPO_PUBLIC_API_BASE_URL=/api

COPY app.json tsconfig.json ./
COPY app ./app
COPY assets ./assets
COPY src ./src
RUN npm run build:web

FROM node:24.19.0-bookworm-slim AS server-runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server ./server
COPY src/shared ./src/shared
COPY prompts/p1/childcare-chat.txt ./prompts/p1/childcare-chat.txt
COPY scripts/encrypt-storage.mjs scripts/storage-backup.mjs ./scripts/

USER node
EXPOSE 3001
CMD ["node", "server/index.ts"]

# Administrative job only: matching PostgreSQL tools, no Docker socket in the API.
FROM postgres:18.6-bookworm AS maintenance
WORKDIR /app
COPY --from=server-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=server-runtime /app /app
RUN node --version && pg_dump --version && pg_restore --version
USER 1000:1000
ENTRYPOINT ["node"]
CMD ["scripts/storage-backup.mjs"]

FROM caddy:2.11.4-alpine AS web
COPY --from=web-build /app/dist /srv
COPY deploy/p1/Caddyfile /etc/caddy/Caddyfile
COPY licenses/caddy/LICENSE /usr/share/licenses/caddy/LICENSE
COPY licenses /srv/licenses
COPY THIRD_PARTY_NOTICES.md /srv/THIRD_PARTY_NOTICES.md

FROM server-runtime AS server
