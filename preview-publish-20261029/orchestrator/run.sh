#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$GITHUB_WORKSPACE/product"
OUT="$RUNNER_TEMP/preview-artifact"
NODE_BIN="$(readlink -f "$(command -v node)")"
NODE_DIR="$(dirname "$NODE_BIN")"
PATH_CLEAN="$RUNNER_TEMP/preview-npm/bin:$NODE_DIR:/usr/bin:/bin:/usr/sbin:/sbin"
test "$(id -u)" -ne 0
test "$(git -C "$ROOT" rev-parse HEAD)" = "$ORCHESTRATION_SHA"
test "$("$NODE_BIN" --version)" = v24.22.1
test ! -e "$OUT"
mkdir -p "$OUT" "$RUNNER_TEMP/preview-home" "$RUNNER_TEMP/preview-tmp"
: > "$RUNNER_TEMP/preview-global.npmrc"
PREVIEW_BUILD_INPUT_MANIFEST="$ROOT/orchestrator/source-snapshots/BUILD_INPUTS.json"
PREVIEW_BUILD_INPUT_MANIFEST_SHA256="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["products"][sys.argv[2]]["buildInputsManifestSha256"])' "$ROOT/orchestrator/manifest.json" "$PRODUCT")"
export PREVIEW_BUILD_COMMIT PREVIEW_BUILD_INPUT_MANIFEST PREVIEW_BUILD_INPUT_MANIFEST_SHA256
python3 -B "$ROOT/orchestrator/proof.py" prepare "$PRODUCT" "$SOURCE" "$OUT"

# Network is allowed only for the exact npm runtime and integrity-locked packages.
# No package lifecycle scripts, inherited credentials, cache, or local npm config.
env -i PATH="$PATH_CLEAN" HOME="$RUNNER_TEMP/preview-home" TMPDIR="$RUNNER_TEMP/preview-tmp" \
  "$NODE_BIN" "$(dirname "$(readlink -f "$(command -v npm)")")/npm-cli.js" \
  install --global --prefix "$RUNNER_TEMP/preview-npm" \
  --userconfig /dev/null --globalconfig "$RUNNER_TEMP/preview-global.npmrc" \
  --ignore-scripts --no-audit --no-fund npm@11.8.0
NPM_CLI="$RUNNER_TEMP/preview-npm/lib/node_modules/npm/bin/npm-cli.js"
test "$("$NODE_BIN" "$NPM_CLI" --version)" = 11.8.0
(
  cd "$SOURCE"
  env -i PATH="$PATH_CLEAN" HOME="$RUNNER_TEMP/preview-home" TMPDIR="$RUNNER_TEMP/preview-tmp" \
    "$NODE_BIN" "$NPM_CLI" ci --userconfig /dev/null \
      --globalconfig "$RUNNER_TEMP/preview-global.npmrc" --ignore-scripts --no-audit --no-fund
)
# Product pins have no postinstall or patch-package. Do not import D's Android patch.
PARENT_NETNS="$(readlink /proc/self/ns/net)"
sudo -n /usr/bin/unshare --net -- \
  /usr/bin/setpriv --reuid="$(id -u)" --regid="$(id -g)" --clear-groups \
    --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs \
  /usr/bin/env -i PATH="$PATH_CLEAN" HOME="$RUNNER_TEMP/preview-home" \
    TMPDIR="$RUNNER_TEMP/preview-tmp" CI=1 TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    NODE_OPTIONS=--max-old-space-size=4096 EXPO_PUBLIC_API_BASE_URL=/api \
    EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 \
    NODE_BIN="$NODE_BIN" NPM_CLI="$NPM_CLI" PARENT_NETNS="$PARENT_NETNS" \
    ROOT="$ROOT" SOURCE="$SOURCE" OUT="$OUT" PRODUCT="$PRODUCT" \
    ORCHESTRATION_SHA="$ORCHESTRATION_SHA" \
    PREVIEW_BUILD_COMMIT="$PREVIEW_BUILD_COMMIT" \
    PREVIEW_BUILD_INPUT_MANIFEST="$PREVIEW_BUILD_INPUT_MANIFEST" \
    PREVIEW_BUILD_INPUT_MANIFEST_SHA256="$PREVIEW_BUILD_INPUT_MANIFEST_SHA256" \
  /usr/bin/bash --noprofile --norc "$ROOT/orchestrator/offline.sh"
