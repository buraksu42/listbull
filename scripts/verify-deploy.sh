#!/usr/bin/env bash
#
# Post-deploy evidence layer. Dokploy marks a deploy "done" without
# guaranteeing the running container actually swapped (observed
# 2026-06-01: a "done" web-app deploy left the previous container
# running, so a merged fix was not live). This compares the LIVE
# /api/health `commit` against the expected git SHA and fails on drift,
# catching a ghost/stale deploy that the Dokploy UI reports as success.
#
# Usage:
#   scripts/verify-deploy.sh [host] [expected-sha]
#     host          default: prod.listbull.org
#     expected-sha  default: `git rev-parse origin/main`
#
# Exit codes: 0 match · 1 drift/unreachable · 2 usage/no-expected.
set -euo pipefail

HOST="${1:-prod.listbull.org}"
EXPECTED="${2:-$(git rev-parse origin/main 2>/dev/null || true)}"

if [ -z "$EXPECTED" ]; then
  echo "✗ no expected SHA — pass one, or run 'git fetch origin main' first" >&2
  exit 2
fi

JSON="$(curl -fsS --max-time 15 "https://${HOST}/api/health")" || {
  echo "✗ health fetch failed for ${HOST}" >&2
  exit 1
}

read_field() { printf '%s' "$JSON" | python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }
LIVE="$(read_field commit)"
BUILT="$(read_field buildTime)"

echo "host:     ${HOST}"
echo "expected: ${EXPECTED}"
echo "live:     ${LIVE:-<none>}  (built ${BUILT:-?})"

if [ -z "$LIVE" ] || [ "$LIVE" = "unknown" ]; then
  echo "✗ live commit is '${LIVE:-<none>}' — health has no usable commit" >&2
  exit 1
fi

# Tolerate short vs full SHA: match if either is a prefix of the other.
case "$EXPECTED" in "${LIVE}"*) MATCH=1 ;; *) MATCH=0 ;; esac
[ "$MATCH" = 1 ] || case "$LIVE" in "${EXPECTED}"*) MATCH=1 ;; esac

if [ "${MATCH:-0}" = 1 ]; then
  echo "✓ live commit matches expected"
else
  echo "✗ DRIFT — live commit != expected (stale/ghost deploy: Dokploy 'done' but container not swapped?)" >&2
  exit 1
fi
