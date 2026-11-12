#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ ${WEB:-} =~ ^(true|false)$ && ${BACKEND:-} =~ ^(true|false)$ ]] || die 'WEB and BACKEND must be true or false.'
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || die 'GITHUB_SHA must be a full immutable revision.'
[[ ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]*$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]*$ ]] || die 'Invalid GitHub run identity.'
[[ ${RUNNER_TEMP:-} = /* && -d $RUNNER_TEMP ]] || die 'RUNNER_TEMP must be an existing absolute directory.'
for name in SITE_ACCESS_TOKEN GOOGLE_APPLICATION_CREDENTIALS GOOGLE_GHA_CREDS_PATH CLOUDSDK_AUTH_ACCESS_TOKEN GOOGLE_APPLICATION_CREDENTIALS_JSON; do
  [[ -z ${!name:-} ]] || die 'Build job must not receive cloud credentials.'
done
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
[[ $(git rev-parse HEAD) = "$GITHUB_SHA" ]] || die 'Checkout HEAD differs from GITHUB_SHA.'
[[ -z $(git status --porcelain --untracked-files=normal) ]] || die 'Build checkout must be clean.'
[[ -f $RUNNER_TEMP/site-preflight/status.json && ! -L $RUNNER_TEMP/site-preflight/status.json ]] || die 'Missing preflight service baselines.'
out=$RUNNER_TEMP/site-images
mkdir -- "$out" # Refuse stale outputs from a previous attempt.

# These are public SDK identifiers and product switches, never server credentials.
public_names=(EXPO_PUBLIC_AUTH_PROVIDER EXPO_PUBLIC_AUTH_PROVIDERS EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL
  EXPO_PUBLIC_FIREBASE_API_KEY EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN EXPO_PUBLIC_FIREBASE_PROJECT_ID EXPO_PUBLIC_FIREBASE_APP_ID)
if [[ $WEB = true ]]; then
  [[ ${EXPO_PUBLIC_AUTH_PROVIDER:-} = firebase ]] || die 'Release Web requires the official Firebase public configuration.'
  [[ -v EXPO_PUBLIC_AUTH_PROVIDERS ]] || die 'Set EXPO_PUBLIC_AUTH_PROVIDERS explicitly, including an empty value when disabled.'
  for name in EXPO_PUBLIC_FIREBASE_API_KEY EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN EXPO_PUBLIC_FIREBASE_PROJECT_ID EXPO_PUBLIC_FIREBASE_APP_ID; do
    [[ -n ${!name:-} ]] || die "Missing public build setting: $name"
  done
  [[ ${EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL:-} = false ]] || die 'Release Web requires EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL=false.'
fi
[[ $(npm --version) = 11.8.0 ]] || npm install --global npm@11.8.0 --no-audit --no-fund
npm ci --no-audit --no-fund
node scripts/site-release/build-checks.mjs "$RUNNER_TEMP/site-preflight/status.json" "$GITHUB_SHA" "$out/checks.json"
[[ -z $(git status --porcelain --untracked-files=normal) ]] || die 'Checks modified the build checkout.'

for service in web backend; do
  selected=$WEB; target=web
  if [[ $service = backend ]]; then selected=$BACKEND; target=firebase-server; fi
  [[ $selected = true ]] || continue
  image="site-release-local/$service:$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  args=(build --target "$target" --tag "$image" --build-arg "SITE_REVISION=$GITHUB_SHA")
  if [[ $service = web ]]; then
    args+=(--build-arg CADDY_CONFIG=deploy/p1/Caddyfile.firestore)
    for name in "${public_names[@]}"; do args+=(--build-arg "$name=${!name:-}"); done
  fi
  docker "${args[@]}" .
  [[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') = "$GITHUB_SHA" ]] || die 'Candidate revision label differs.'
  if [[ $service = web ]]; then
    docker run --rm --network none --env "EXPECTED_REVISION=$GITHUB_SHA" --entrypoint sh "$image" -ec '
      caddy file-server --root /srv --listen :8080 >/tmp/caddy.log 2>&1 &
      trap "kill $! 2>/dev/null || true" EXIT
      ready=false
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if body=$(wget -qO- http://127.0.0.1:8080/site-version.json 2>/dev/null); then ready=true; break; fi
        sleep 1
      done
      test "$ready" = true
      test "$body" = "{\"revision\":\"$EXPECTED_REVISION\"}"
      for path in manifest.webmanifest icons/apple-touch-icon.png icons/icon-192.png icons/icon-512.png; do
        wget -qO /dev/null "http://127.0.0.1:8080/$path"
      done'
  else
    # Start the actual HTTP transport and handler with inert adapters, offline.
    docker run --rm --interactive --network none --env "EXPECTED_REVISION=$GITHUB_SHA" --entrypoint node "$image" --input-type=module - <<'NODE'
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFirebaseRequestHandler } from './server/firebase-app.ts';
import { createFirebaseNodeHandler } from './server/firebase-http.ts';
const publicOrigin = 'http://127.0.0.1:3001';
const unexpected = () => { throw new Error('Offline smoke must not access cloud services'); };
const auth = { getSession: unexpected, handler: unexpected,
  fromNodeHeaders: input => new Headers(Object.entries(input).flatMap(([name,value]) => value === undefined ? [] : [[name,Array.isArray(value) ? value.join(', ') : value]])) };
const handler = createFirebaseRequestHandler({ publicOrigin, mailConfigured: false, auth,
  authority: { accountStatus: unexpected, acknowledge: unexpected } });
const server = createServer(createFirebaseNodeHandler({ publicOrigin, auth, handler }));
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(3001,'127.0.0.1',resolve); });
try {
  const version = await fetch(publicOrigin + '/api/version');
  assert.equal(version.status,200);
  assert.deepEqual(await version.json(),{ revision:process.env.EXPECTED_REVISION });
  assert.equal(version.headers.get('cache-control'),'private, no-store');
  assert.equal((await fetch(publicOrigin + '/healthz')).status,200);
} finally { await new Promise(resolve => server.close(resolve)); }
NODE
  fi
  docker save "$image" | gzip -n > "$out/$service.tar.gz"
  gzip -t "$out/$service.tar.gz"
done

node - "$out" <<'NODE'
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const out=process.argv[2], revision=process.env.GITHUB_SHA, services={};
for (const name of ['web','backend']) {
  if (process.env[name.toUpperCase()] !== 'true') continue;
  const imageTag=`site-release-local/${name}:${revision}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  const imageId=execFileSync('docker',['image','inspect',imageTag,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid candidate image ID');
  const archive=name+'.tar.gz', hash=createHash('sha256');
  for await (const bytes of createReadStream(join(out,archive))) hash.update(bytes);
  services[name]={ archive, imageTag, imageId, revision, sha256:hash.digest('hex') };
}
await writeFile(join(out,'SHA256SUMS'),Object.values(services).map(s=>`${s.sha256}  ${s.archive}\n`).join(''),{flag:'wx'});
await writeFile(join(out,'manifest.json'),JSON.stringify({schemaVersion:1,revision,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,services},null,2)+'\n',{flag:'wx'});
NODE
