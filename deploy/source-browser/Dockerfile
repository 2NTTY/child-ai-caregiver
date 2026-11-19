FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 AS browsers
FROM node:24.19.0-bookworm-slim@sha256:e5a8dee7bc1e6a215d224a7ef8206f7e77271bc3cabd5febf2beafac0674f174 AS node-base

FROM node-base AS driver
WORKDIR /app
COPY package-lock.json /tmp/source-lock.json
# Install only the same browser driver as the repository. Verify its locked digest.
RUN node --input-type=module -e "import fs from 'node:fs'; import {createHash} from 'node:crypto'; const lock=JSON.parse(fs.readFileSync('/tmp/source-lock.json')).packages['node_modules/playwright-core']; const response=await fetch(lock.resolved); if(!response.ok)throw Error('driver download'); const bytes=Buffer.from(await response.arrayBuffer()); if('sha512-'+createHash('sha512').update(bytes).digest('base64')!==lock.integrity)throw Error('driver integrity'); fs.writeFileSync('/tmp/driver.tgz',bytes)" \
    && mkdir -p node_modules/playwright-core \
    && tar -xzf /tmp/driver.tgz --strip-components=1 -C node_modules/playwright-core \
    && node -e "const browser=require('./node_modules/playwright-core/browsers.json').browsers.find(b=>b.name==='chromium-headless-shell'); if(browser?.revision!=='1243') throw Error('Update the pinned headless shell alongside the driver')"

FROM node-base AS runtime-files
WORKDIR /app
# Playwright 1.63's Debian 12 chromium libraries plus Latin and Chinese fonts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation fonts-wqy-zenhei \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
      libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o node -g node /runtime/run/source-browser
# Retain the complete installed library directory, including NSS/dlopen modules,
# font discovery data and package notices. Build tools stay in this stage.
RUN cd / && cp -a --parents usr/local/bin/node usr/local/LICENSE usr/bin/test \
      usr/lib/x86_64-linux-gnu usr/lib64 usr/lib/os-release etc/os-release etc/ld.so.cache \
      etc/passwd etc/group etc/nsswitch.conf etc/fonts usr/share/fonts usr/share/fontconfig \
      usr/share/glib-2.0 usr/share/X11/xkb var/cache/fontconfig usr/share/doc usr/share/common-licenses /runtime/ \
    && ln -s usr/lib /runtime/lib && ln -s usr/lib64 /runtime/lib64 \
    && mkdir -p /runtime/tmp && chmod 1777 /runtime/tmp

FROM browsers AS shell
RUN cd /ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64 \
    && echo 'ded93a9c9a53a1ae040f08124badcca95c938e9d5015ff340c3b5538c41bf39e  chrome-headless-shell' | sha256sum -c - \
    && find locales -type f ! -name 'en*.pak' ! -name 'zh*.pak' -delete

FROM scratch
COPY --from=runtime-files /runtime/ /
COPY --from=shell /ms-playwright/chromium_headless_shell-1243 /ms-playwright/chromium_headless_shell-1243
ENV PATH=/usr/local/bin:/usr/bin PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=driver /app/node_modules/playwright-core /app/node_modules/playwright-core
COPY server/source-card-render.mjs server/source-card-sandbox.mjs server/source-card-controls.mjs ./
ARG SITE_REVISION
LABEL org.opencontainers.image.revision=${SITE_REVISION}
ENV HOME=/tmp DEBUG=""
USER 1000:1000
CMD ["node","source-card-sandbox.mjs"]
