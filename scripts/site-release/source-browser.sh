#!/usr/bin/env bash
# Publish on the build machine. Apply, rollback and recovery use the existing IAP identity.
set -euo pipefail
repo=asia-east2-docker.pkg.dev/ai-caregivers-for-children/site-release/source-browser
rev=$(git rev-parse HEAD)
action=${1:-}
receipt=${2:-}
usage='Usage: source-browser.sh publish|apply RECEIPT | rollback sha256:DIGEST | status | recover'
case "$action" in
  publish|apply|rollback) [[ $# == 2 && -n $receipt ]] || { echo "$usage" >&2; exit 2; } ;;
  status|recover) [[ $# == 1 ]] || { echo "$usage" >&2; exit 2; } ;;
  *) echo "$usage" >&2; exit 2 ;;
esac

read_receipt() {
  local extra
  read -r image_rev digest cold extra < "$receipt"
  [[ -z $extra && $image_rev =~ ^[a-f0-9]{40}$ && $digest =~ ^sha256:[a-f0-9]{64}$ && $cold =~ ^[1-9][0-9]{0,12}$ ]] ||
    { echo 'Invalid renderer receipt' >&2; exit 2; }
}

if [[ $action == publish && ! -f $receipt ]]; then
  [[ $rev == "$(git ls-remote origin refs/heads/master | cut -f1)" ]] ||
    { echo 'Use the integrated upstream master checkout' >&2; exit 1; }
fi
if [[ $action == publish ]]; then
  if [[ -f $receipt ]]; then
    read_receipt
    [[ $rev == "$image_rev" ]] || { echo 'Receipt is for a different revision' >&2; exit 1; }
    echo "$repo@$digest"
    exit 0
  fi
  # Use only the committed files referenced by the renderer Dockerfile. A previous push
  # may have succeeded before the receipt write, so look up the exact revision first.
  scratch=$(mktemp -d)
  smoke_project="renderer-check-${rev:0:12}-$$-$RANDOM"
  smoke=(docker compose --env-file "$scratch/empty.env" -p "$smoke_project" -f "$scratch/compose.yaml")
  smoke_volume=
  cleanup() {
    if [[ -n $smoke_volume ]]; then
      "${smoke[@]}" down && docker volume rm "$smoke_volume"
    fi
    rm -f "$scratch/lookup" "$scratch/push" "$scratch/compose.yaml" "$scratch/seccomp.json" "$scratch/empty.env"
    rmdir "$scratch"
  }
  trap cleanup EXIT
  if docker pull --platform linux/amd64 "$repo:$rev" > "$scratch/lookup" 2>&1; then
    digest=$(sed -nE 's/^Digest: (sha256:[0-9a-f]{64})$/\1/p' "$scratch/lookup")
  else
    grep -Eiq 'manifest unknown|manifest_unknown|name unknown|: not found' "$scratch/lookup" ||
      { echo 'Registry lookup failed; check the existing release identity' >&2; exit 1; }
    git archive "$rev" -- deploy/source-browser/Dockerfile package-lock.json server/source-card-render.mjs \
      server/source-card-sandbox.mjs server/source-card-controls.mjs |
      docker buildx build --platform linux/amd64 --pull --no-cache --provenance=false --load \
        -f deploy/source-browser/Dockerfile --build-arg SITE_REVISION="$rev" -t "$repo:$rev" -
    docker push "$repo:$rev" | tee "$scratch/push"
    digest=$(sed -nE 's/^.*: digest: (sha256:[0-9a-f]{64}) size: [0-9]+$/\1/p' "$scratch/push")
  fi
  [[ $digest =~ ^sha256:[a-f0-9]{64}$ ]]
  ref="$repo@$digest"
  docker pull --platform linux/amd64 "$ref"
  [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Os}}/{{.Architecture}}' "$ref") == "$rev linux/amd64" ]]
  git show "$rev:deploy/source-browser/compose.yaml" > "$scratch/compose.yaml"
  git show "$rev:deploy/source-browser/seccomp.json" > "$scratch/seccomp.json"
  touch "$scratch/empty.env"
  export SOURCE_BROWSER_IMAGE="$ref" SOURCE_BROWSER_IPC_VOLUME="$smoke_project-ipc"
  docker volume create "$SOURCE_BROWSER_IPC_VOLUME"
  smoke_volume=$SOURCE_BROWSER_IPC_VOLUME
  "${smoke[@]}" up -d --pull never --no-build --wait --wait-timeout 60 source-browser
  "${smoke[@]}" exec -T source-browser node -e "
    require('node:http').get({socketPath:'/run/source-browser/render.sock',path:'/healthz'},r=>{
      let text='';r.on('data',chunk=>text+=chunk);r.on('end',()=>process.exit(r.statusCode===200&&text==='ready'?0:1));
    }).on('error',()=>process.exit(1)).setTimeout(3000,function(){this.destroy()})"
  bytes=$(docker image inspect --format '{{.Size}}' "$ref")
  layers=$(docker history --no-trunc --human=false --format '{{.Size}}' "$ref" | awk '{s+=$1} END {printf "%.0f",s}')
  # link publishes a complete receipt without overwriting a simultaneous publisher.
  tmp=$(mktemp "${receipt}.XXXXXX")
  printf '%s %s %s\n' "$rev" "$digest" "$((bytes + layers))" > "$tmp"
  if ! ln "$tmp" "$receipt"; then
    cmp -s "$tmp" "$receipt" || { rm -f "$tmp"; echo 'Different receipt already exists' >&2; exit 1; }
  fi
  rm -f "$tmp"
  echo "$ref"
  exit 0
fi

case "$action" in
  apply)
    read_receipt
    [[ $rev == "$image_rev" ]] || { echo 'Use the candidate revision checkout' >&2; exit 1; }
    args="apply $image_rev $digest $cold" ;;
  rollback)
    [[ $receipt =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Supply the digest being rolled back' >&2; exit 2; }
    args="rollback $receipt" ;;
  *) args=$action ;;
esac
target=yuban-p1
if [[ -n ${SITE_SSH_USER:-} ]]; then
  [[ $SITE_SSH_USER =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
  target="$SITE_SSH_USER@$target"
fi
gcloud compute ssh "$target" --project=ai-caregivers-for-children --zone=asia-east2-a --tunnel-through-iap --quiet \
  --command="sudo python3 /var/lib/yuyoufang-site-install/$rev/deploy/source-browser/manage.py $args"
