FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /app
COPY package-lock.json /tmp/source-lock.json
# Install only the same browser driver as the repository. Verify its locked digest.
RUN node --input-type=module -e "import fs from 'node:fs'; import {createHash} from 'node:crypto'; const lock=JSON.parse(fs.readFileSync('/tmp/source-lock.json')).packages['node_modules/playwright-core']; const response=await fetch(lock.resolved); if(!response.ok)throw Error('driver download'); const bytes=Buffer.from(await response.arrayBuffer()); if('sha512-'+createHash('sha512').update(bytes).digest('base64')!==lock.integrity)throw Error('driver integrity'); fs.writeFileSync('/tmp/driver.tgz',bytes)" \
    && mkdir -p node_modules/playwright-core /run/source-browser \
    && tar -xzf /tmp/driver.tgz --strip-components=1 -C node_modules/playwright-core \
    && rm /tmp/driver.tgz /tmp/source-lock.json \
    && chown 1000:1000 /run/source-browser
COPY server/source-card-render.mjs server/source-card-sandbox.mjs server/source-card-controls.mjs ./
ENV HOME=/tmp DEBUG=""
USER 1000:1000
CMD ["node","source-card-sandbox.mjs"]
