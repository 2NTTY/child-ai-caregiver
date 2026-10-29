#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
stage=isolation
trap 'status=$?; printf "FAIL product=%s stage=%s exit=%s\n" "$PRODUCT" "$stage" "$status" >&2; exit "$status"' ERR
test "$(id -u)" -ne 0
test "$(readlink /proc/self/ns/net)" != "$PARENT_NETNS"
test "$(ip -o link show | wc -l)" -eq 1
ip -o link show lo | grep -Eq '^[0-9]+: lo:.*state DOWN'
test -z "$(ip -4 route show table all)"
test -z "$(ip -6 route show table all)"
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
awk '/^Cap(Inh|Prm|Eff|Bnd|Amb):/ {if ($2 != "0000000000000000") bad=1; count++} END {exit (bad || count != 5)}' /proc/self/status
cd "$SOURCE"
stage=runtime-and-source-closure
python3 "$ROOT/orchestrator/proof.py" before "$PRODUCT" "$SOURCE" "$OUT"
test "$("$NODE_BIN" --version)" = v24.22.1
test "$("$NODE_BIN" "$NPM_CLI" --version)" = 11.8.0
if [[ "$PRODUCT" == fourth ]]; then
  stage=fourth-synthetic-admission
  "$NODE_BIN" "$ROOT/fourth/tests/admission.mjs" "$SOURCE"
fi
stage=normal-frontend-typecheck
"$NODE_BIN" node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit --pretty false
stage=normal-expo-export
timeout --signal=TERM --kill-after=10s 900s "$NODE_BIN" "$NPM_CLI" run build:web --workspace frontend -- \
  --clear --max-workers 1 --source-maps external --output-dir "$OUT/../preview-raw-private"
stage=mapfree-synthetic-preview-closure
ADAPTER="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["products"][sys.argv[2]]["adapter"])' "$ROOT/orchestrator/manifest.json" "$PRODUCT")"
python3 -B "$ROOT/$ADAPTER" --source "$SOURCE" --raw "$OUT/../preview-raw-private" \
  --out "$OUT/site" --proof "$TMPDIR/adapter-proof.json"
stage=provenance-and-size-gates
python3 "$ROOT/orchestrator/proof.py" after "$PRODUCT" "$SOURCE" "$OUT"
printf 'PASS product=%s source=%s sanitized site/proof artifact only; native-browser and publication pending\n' \
  "$PRODUCT" "$(git rev-parse HEAD)"
