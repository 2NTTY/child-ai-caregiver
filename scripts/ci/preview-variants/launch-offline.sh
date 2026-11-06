#!/usr/bin/env bash
# DRAFT: never invoke outside an authorized disposable GitHub runner.
set -Eeuo pipefail
umask 077
[[ $# == 5 ]]
AREA=$1
CANDIDATE=$2
TOOLCHAIN=$3
VARIANT=$4
EXPECTED_SHA=$5
[[ "$VARIANT" == fourth || "$VARIANT" == harbour ]]
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$(id -u)" -ne 0 ]]
for p in "$AREA" "$CANDIDATE" "$TOOLCHAIN"; do
  [[ "$p" == /* && -d "$p" && ! -L "$p" && "$(readlink -f "$p")" == "$p" ]]
done
PARENT_NETNS=$(readlink /proc/self/ns/net)
# No global cleanup and no cancelling unrelated workflow runs. All mounts below
# exist only inside this newly created namespace. No host home or credentials bind.
set +e
sudo -n /usr/bin/unshare --mount --net --pid --fork --kill-child=KILL -- \
  /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/bash --noprofile --norc "$CANDIDATE/sandbox-root.sh" \
  "$AREA" "$CANDIDATE" "$TOOLCHAIN" "$VARIANT" "$EXPECTED_SHA" \
  "$(id -u)" "$(id -g)" "$PARENT_NETNS" > "$AREA/work/bootstrap.raw" 2>&1
status=$?
set -e
# Numeric-only host terminal, even if namespace setup failed before runner start.
printf '{"sandboxExitCode":%s,"artifactUpload":"DISABLED"}\n' "$status" > "$AREA/work/sandbox-terminal.json"
exit "$status"
