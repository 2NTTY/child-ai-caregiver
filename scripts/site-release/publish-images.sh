#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ ${WEB:-} =~ ^(true|false)$ && ${BACKEND:-} =~ ^(true|false)$ ]] || die 'WEB and BACKEND must be true or false.'
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || die 'Invalid immutable revision.'
[[ ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]*$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]*$ ]] || die 'Invalid GitHub run identity.'
[[ ${RUNNER_TEMP:-} = /* && -d $RUNNER_TEMP ]] || die 'Invalid RUNNER_TEMP.'
[[ -n ${SITE_ACCESS_TOKEN:-} ]] || die 'SITE_ACCESS_TOKEN is required.'
out=$RUNNER_TEMP/site-images
[[ -d $out && ! -L $out && ! -e $RUNNER_TEMP/digests.json ]] || die 'Missing candidates or stale digest output.'
registry=asia-east2-docker.pkg.dev
repository=$registry/ai-caregivers-for-children/site-release
plan=$(mktemp "$RUNNER_TEMP/site-image-plan.XXXXXX")
digests=$(mktemp "$RUNNER_TEMP/site-image-digests.XXXXXX")
auth_dir=''
trap 'rm -f -- "$plan" "$digests"; if [[ -n $auth_dir ]]; then rm -rf -- "$auth_dir"; fi' EXIT

# Standard-library parsing and hashing only. Never run an image or npm here.
node - "$out" > "$plan" <<'NODE'
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const out=process.argv[2];
function regular(name,max=Infinity) {
  const path=join(out,name), file=lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size>max) throw new Error('Invalid artifact file: '+name);
  return path;
}
const manifest=JSON.parse(readFileSync(regular('manifest.json',65536),'utf8'));
if (manifest.schemaVersion!==1 || manifest.revision!==process.env.GITHUB_SHA || manifest.runId!==process.env.GITHUB_RUN_ID || manifest.runAttempt!==process.env.GITHUB_RUN_ATTEMPT) throw new Error('Candidate provenance differs');
const selected=['web','backend'].filter(name=>process.env[name.toUpperCase()]==='true');
if (!manifest.services || JSON.stringify(Object.keys(manifest.services).sort())!==JSON.stringify([...selected].sort())) throw new Error('Candidate services differ');
let sums='';
for (const name of selected) {
  const item=manifest.services[name], tag=`site-release-local/${name}:${manifest.revision}-${manifest.runId}-${manifest.runAttempt}`;
  if (item.archive!==name+'.tar.gz' || item.imageTag!==tag || item.revision!==manifest.revision || !/^sha256:[a-f0-9]{64}$/.test(item.imageId) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid candidate metadata');
  const hash=createHash('sha256');
  for await (const bytes of createReadStream(regular(item.archive))) hash.update(bytes);
  if (hash.digest('hex')!==item.sha256) throw new Error('Candidate archive checksum differs');
  sums+=`${item.sha256}  ${item.archive}\n`;
  console.log([name,item.imageTag,item.imageId,item.revision].join('\t'));
}
if (readFileSync(regular('SHA256SUMS',4096),'utf8')!==sums) throw new Error('Checksum list differs');
NODE

while IFS=$'\t' read -r service image image_id revision; do
  gzip -t "$out/$service.tar.gz"
  docker load --input "$out/$service.tar.gz"
  [[ $(docker image inspect "$image" --format '{{.Id}}') = "$image_id" ]] || die 'Loaded candidate image ID differs.'
  [[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') = "$revision" ]] || die 'Loaded candidate revision label differs.'
done < "$plan"

printf '{}\n' > "$digests"
if [[ -s $plan ]]; then
  auth_dir=$(mktemp -d "$RUNNER_TEMP/site-docker-auth.XXXXXX")
  export DOCKER_CONFIG=$auth_dir
  printf '%s' "$SITE_ACCESS_TOKEN" | docker login --username oauth2accesstoken --password-stdin "$registry"
  unset SITE_ACCESS_TOKEN
  while IFS=$'\t' read -r service image image_id revision; do
    remote="$repository/$service:$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    docker tag "$image_id" "$remote"
    docker push "$remote"
    digest=$(docker image inspect "$remote" --format '{{json .RepoDigests}}' | node -e '
      const fs=require("node:fs"), prefix=process.argv[1]+"@";
      const values=JSON.parse(fs.readFileSync(0,"utf8")).filter(value=>value.startsWith(prefix));
      if(values.length!==1||!/^sha256:[a-f0-9]{64}$/.test(values[0].slice(prefix.length)))throw Error("Missing unique pushed image digest");
      process.stdout.write(values[0].slice(prefix.length));' "$repository/$service")
    node - "$digests" "$service" "$digest" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [path,service,digest]=process.argv.slice(2), result=JSON.parse(readFileSync(path,'utf8'));
result[service]=digest;
writeFileSync(path,JSON.stringify(result)+'\n');
NODE
  done < "$plan"
fi
mv -- "$digests" "$RUNNER_TEMP/digests.json"
