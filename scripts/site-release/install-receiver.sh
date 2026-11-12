#!/usr/bin/env bash
# One-time operator action or reviewed receiver upgrade. Uses committed files only.
set -euo pipefail
project=ai-caregivers-for-children
zone=asia-east2-a
vm=yuban-p1
site_sha=$(git rev-parse HEAD)
upstream=$(git ls-remote origin refs/heads/master | cut -f1)
[[ $site_sha == "$upstream" ]] || { echo 'Checkout must match upstream master for installation' >&2; exit 1; }
files=(activity.sh host.py install-host.sh protocol.py store.py site-release.service site-release.timer)
paths=()
for file in "${files[@]}"; do paths+=("deploy/site-release/$file"); done
git diff --quiet HEAD -- "${paths[@]}" || { echo 'Commit or set aside receiver edits first' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -f "$tmp/receiver.tgz"; rmdir "$tmp"' EXIT
git archive --format=tar.gz --output="$tmp/receiver.tgz" HEAD -- "${paths[@]}"
hash=$(sha256sum "$tmp/receiver.tgz" | cut -d' ' -f1)
flags=(--project="$project" --zone="$zone" --tunnel-through-iap --quiet)
# Explicit OS Login name can be supplied on workstations with a different local user.
target=$vm
if [[ -n ${SITE_SSH_USER:-} ]]; then
  [[ $SITE_SSH_USER =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
  target="$SITE_SSH_USER@$vm"
fi
remote="site-release-$site_sha"
gcloud compute ssh "$target" "${flags[@]}" --command="umask 077 && mkdir -p $remote && chmod 700 $remote"
gcloud compute scp "$tmp/receiver.tgz" "$target:$remote/receiver.tgz" "${flags[@]}"
gcloud compute ssh "$target" "${flags[@]}" --command="sudo install -d -m 0700 /var/lib/yuyoufang-site-install/$site_sha && sudo install -m 0600 $remote/receiver.tgz /var/lib/yuyoufang-site-install/$site_sha/receiver.tgz && sudo sh -ec 'cd /var/lib/yuyoufang-site-install/$site_sha && echo \"$hash  receiver.tgz\" | sha256sum -c - && tar -xzf receiver.tgz && bash deploy/site-release/install-host.sh' && rm -f $remote/receiver.tgz && rmdir $remote"
