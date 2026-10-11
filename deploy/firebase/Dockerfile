FROM node:24.19.0-bookworm-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 STORAGE_BACKEND=firestore
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm install --global npm@11.8.0 --no-audit --no-fund \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY server ./server
COPY src/shared ./src/shared
COPY licenses ./licenses
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY scripts/firebase-control.mjs scripts/firebase-recovery.mjs ./scripts/
USER node
EXPOSE 8080
# The private worker uses the same reviewed image with server/firebase-worker-main.ts.
CMD ["node", "server/firebase-main.ts"]
