FROM node:24.19.0-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY frontend/patches ./frontend/patches
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && npm ci --no-audit --no-fund

FROM deps AS web-build

# Firebase Web SDK identifiers are public; never pass Admin credentials as build args.
ARG EXPO_PUBLIC_AUTH_PROVIDER
ARG EXPO_PUBLIC_FIREBASE_API_KEY
ARG EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG EXPO_PUBLIC_FIREBASE_PROJECT_ID
ARG EXPO_PUBLIC_FIREBASE_APP_ID
ENV EXPO_PUBLIC_AUTH_PROVIDER=${EXPO_PUBLIC_AUTH_PROVIDER} \
    EXPO_PUBLIC_FIREBASE_API_KEY=${EXPO_PUBLIC_FIREBASE_API_KEY} \
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN} \
    EXPO_PUBLIC_FIREBASE_PROJECT_ID=${EXPO_PUBLIC_FIREBASE_PROJECT_ID} \
    EXPO_PUBLIC_FIREBASE_APP_ID=${EXPO_PUBLIC_FIREBASE_APP_ID}
RUN if [ "$EXPO_PUBLIC_AUTH_PROVIDER" = firebase ]; then \
      test -n "$EXPO_PUBLIC_FIREBASE_API_KEY" && test -n "$EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN" \
      && test -n "$EXPO_PUBLIC_FIREBASE_PROJECT_ID" && test -n "$EXPO_PUBLIC_FIREBASE_APP_ID"; \
    fi

ENV CI=1 \
    EXPO_NO_TELEMETRY=1 \
    EXPO_PUBLIC_API_BASE_URL=/api

COPY frontend/app.json frontend/tsconfig.json frontend/index.js ./frontend/
COPY frontend/app ./frontend/app
COPY frontend/assets ./frontend/assets
COPY frontend/src ./frontend/src
COPY src/client ./src/client
COPY src/config ./src/config
COPY src/shared ./src/shared
COPY public ./public
COPY licenses ./licenses
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY scripts/prepare-web-output.mjs ./scripts/prepare-web-output.mjs
RUN npm run build:web

FROM node:24.19.0-bookworm-slim AS server-runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY frontend/patches ./frontend/patches
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server ./server
COPY src/shared ./src/shared
COPY prompts ./prompts
COPY knowledge ./knowledge
COPY scripts/firebase-control.mjs scripts/firebase-recovery.mjs scripts/firebase-photo-cleanup.mjs ./scripts/
COPY scripts/knowledge.mjs scripts/knowledge-refresh.mjs ./scripts/

USER node
EXPOSE 3001
CMD ["node", "server/main.ts"]

# Recovery uses the same Node/Firestore tools and external protected configuration.
FROM server-runtime AS maintenance
ENTRYPOINT ["node"]
CMD ["scripts/firebase-recovery.mjs"]

FROM caddy:2.11.4-alpine AS web
COPY --from=web-build /app/frontend/dist /srv
ARG CADDY_CONFIG=deploy/p1/Caddyfile.firestore
COPY ${CADDY_CONFIG} /etc/caddy/Caddyfile
COPY licenses/caddy/LICENSE /usr/share/licenses/caddy/LICENSE
COPY licenses /srv/licenses
COPY THIRD_PARTY_NOTICES.md /srv/THIRD_PARTY_NOTICES.md

FROM server-runtime AS server

# Compatibility target for the existing Firestore VM deployment.
FROM server-runtime AS firebase-server
ENV STORAGE_BACKEND=firestore
CMD ["node", "server/main.ts"]
