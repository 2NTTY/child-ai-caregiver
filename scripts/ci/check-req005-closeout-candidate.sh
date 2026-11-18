#!/usr/bin/env bash
set -Eeuo pipefail

for value in "${EXPECTED_SHA:-}" "${EXPECTED_HEAD_SHA:-}" "${EXPECTED_BASE_SHA:-}"; do
  [[ "$value" =~ ^[0-9a-f]{40}$ ]]
done
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
case "${CANDIDATE_MODE:-}" in
  head)
    test "$EXPECTED_SHA" = "$EXPECTED_HEAD_SHA"
    ;;
  merge)
    # A merge result must contain exactly the event base and PR head, in order.
    test "$(git show -s --format=%P HEAD)" = "$EXPECTED_BASE_SHA $EXPECTED_HEAD_SHA"
    ;;
  *) printf 'Invalid closeout candidate mode\n' >&2; exit 1 ;;
esac
printf 'closeout-candidate: mode=%s sha=%s tree=%s base=%s head=%s\n' \
  "$CANDIDATE_MODE" "$EXPECTED_SHA" "$(git rev-parse 'HEAD^{tree}')" \
  "$EXPECTED_BASE_SHA" "$EXPECTED_HEAD_SHA"
