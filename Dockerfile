FROM postgres:18.6-bookworm AS vector-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git build-essential "postgresql-server-dev-18=${PG_VERSION}" \
    && git init /tmp/pgvector \
    && git -C /tmp/pgvector remote add origin https://github.com/pgvector/pgvector.git \
    && git -C /tmp/pgvector fetch --depth 1 origin 8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c \
    && git -C /tmp/pgvector checkout --detach FETCH_HEAD \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector OPTFLAGS="" install

FROM postgres:18.6-bookworm AS postgres-vector
LABEL org.opencontainers.image.description="PostgreSQL 18.6 with pgvector 0.8.6" \
    org.opencontainers.image.source="https://github.com/pgvector/pgvector" \
    org.opencontainers.image.revision="8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c"
COPY --from=vector-build /usr/lib/postgresql/18/lib/vector.so /usr/lib/postgresql/18/lib/vector.so
COPY --from=vector-build /usr/share/postgresql/18/extension/vector* /usr/share/postgresql/18/extension/
COPY --from=vector-build /tmp/pgvector/LICENSE /usr/share/doc/pgvector/LICENSE

FROM node:24.19.0-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && npm ci --no-audit --no-fund

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
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server ./server
COPY src/shared ./src/shared
COPY prompts ./prompts
COPY knowledge ./knowledge
COPY scripts/encrypt-storage.mjs scripts/storage-backup.mjs scripts/knowledge.mjs ./scripts/

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
