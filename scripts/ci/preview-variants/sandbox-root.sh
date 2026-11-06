#!/usr/bin/env bash
# Called only by launch-offline.sh in fresh private mount/net/PID namespaces.
set -Eeuo pipefail
umask 077
[[ $# == 8 && "$(id -u)" == 0 && $$ == 1 ]]
AREA=$1 CANDIDATE=$2 TOOLCHAIN=$3 VARIANT=$4 EXPECTED_SHA=$5 OWNER_UID=$6 OWNER_GID=$7 PARENT_NETNS=$8
[[ "$OWNER_UID" =~ ^[1-9][0-9]*$ && "$OWNER_GID" =~ ^[0-9]+$ ]]
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$VARIANT" == fourth || "$VARIANT" == harbour ]]
phase() { printf '{"phase":"%s"}\n' "$1" > "$AREA/work/bootstrap-progress.json"; chmod 644 "$AREA/work/bootstrap-progress.json"; }
phase namespace-entry
mount --make-rprivate /
phase private-root
ROOT=$(mktemp -d "$AREA/chroot.XXXXXXXX")
mount -t tmpfs -o mode=755,nosuid,nodev tmpfs "$ROOT"
for p in usr bin sbin lib lib64 proc dev tmp work project candidate toolchain npm etc; do mkdir "$ROOT/$p"; done
chmod 755 "$ROOT/dev" "$ROOT/etc"
: > "$ROOT/etc/empty-global.npmrc"
chmod 444 "$ROOT/etc/empty-global.npmrc"
bind_ro() { mount --bind "$1" "$2"; mount -o remount,bind,ro,nosuid,nodev "$2"; }
# Only base OS executables/libraries, never host /etc, /home, /run, /sys, or sockets.
phase readonly-mounts
for p in usr bin sbin lib lib64; do if [[ -d /$p ]]; then bind_ro "/$p" "$ROOT/$p"; fi; done
bind_ro "$AREA/project" "$ROOT/project"
bind_ro "$CANDIDATE" "$ROOT/candidate"
bind_ro "$TOOLCHAIN" "$ROOT/toolchain"
bind_ro "$AREA/npm" "$ROOT/npm"
phase output-mounts
mount --bind "$AREA/work" "$ROOT/work"
mount --bind "$AREA/work/tmp" "$ROOT/tmp"
mount --bind "$AREA/work/dist" "$ROOT/project/frontend/dist"
mount --bind "$AREA/work/expo" "$ROOT/project/frontend/.expo"
mount -t proc -o nosuid,nodev,noexec proc "$ROOT/proc"
phase device-mounts
for p in null zero random urandom; do touch "$ROOT/dev/$p"; mount --bind "/dev/$p" "$ROOT/dev/$p"; done
ln -s /proc/self/fd "$ROOT/dev/fd"
ln -s /proc/self/fd/0 "$ROOT/dev/stdin"
ln -s /proc/self/fd/1 "$ROOT/dev/stdout"
ln -s /proc/self/fd/2 "$ROOT/dev/stderr"
# Close inherited cwd access to the host before chroot; no saved host directory FD.
phase privilege-drop
cd "$ROOT"
exec /usr/sbin/chroot "$ROOT" /usr/bin/setpriv \
  --reuid="$OWNER_UID" --regid="$OWNER_GID" --clear-groups \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  /usr/bin/env -i PATH=/toolchain/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  HOME=/work/home TMPDIR=/work/tmp CI=true TZ=UTC LC_ALL=C.UTF-8 \
  EXPECTED_SHA="$EXPECTED_SHA" PARENT_NETNS="$PARENT_NETNS" VARIANT="$VARIANT" \
  /usr/bin/python3 -B /candidate/runner.py
