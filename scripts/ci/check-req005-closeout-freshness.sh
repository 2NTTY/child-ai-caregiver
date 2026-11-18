#!/usr/bin/env bash
set -Eeuo pipefail
for value in "${EXPECTED_HEAD_SHA:-}" "${EXPECTED_BASE_SHA:-}"; do
  [[ "$value" =~ ^[0-9a-f]{40}$ ]]
done
# Read-only remote comparison; never fetch, merge, push, or rewrite the candidate.
refs="$(git ls-remote --exit-code "${CANDIDATE_REMOTE:-origin}" \
  refs/heads/master refs/heads/codex/req005-acceptance-closeout)"
base="$(awk '$2 == "refs/heads/master" {print $1}' <<< "$refs")"
head="$(awk '$2 == "refs/heads/codex/req005-acceptance-closeout" {print $1}' <<< "$refs")"
if test "$base" != "$EXPECTED_BASE_SHA" || test "$head" != "$EXPECTED_HEAD_SHA"; then
  printf 'Stale closeout event: update the PR with current master and validate a new synchronize event; rerunning this event cannot refresh its base.\n' >&2
  exit 1
fi
printf 'closeout-freshness: base=%s head=%s\n' "$base" "$head"
