#!/usr/bin/env bash
# smoke.sh — is gridironpicks.us actually serving the app?
#
# Sourced or executed by deploy.sh and rollback.sh. Exits 0 when healthy, 1 with
# a reason on stdout otherwise. Deliberately checks the API too: a frontend build
# can be perfect while the container behind /api is down, and a deploy that only
# proves the static files landed would call that a success.
set -uo pipefail

SITE="${SMOKE_URL:-https://gridironpicks.us}"

fail() { echo "  ✗ $1"; exit 1; }

# ── The app itself ──────────────────────────────────────────────────────────

BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

STATUS=$(curl -sf -L -o "$BODY" -w "%{http_code}" \
    --connect-timeout 10 --max-time 20 "$SITE" || echo "000")

[ "$STATUS" = "200" ] || fail "HTTP ${STATUS} from ${SITE}"

# The SPA shell, not a Caddy error page or somebody else's vhost. The title is
# in index.html and survives the build; the script tag proves vite actually
# emitted a bundle rather than the directory holding a stale index.html alone.
grep -qi "<title>Gridiron</title>" "$BODY" || fail "body has no Gridiron title — wrong site or empty build"
grep -qi "<script" "$BODY" || fail "body has no script tag — build looks empty"

echo "  ✓ ${SITE} → 200, app shell present"

# ── The API behind it ───────────────────────────────────────────────────────
#
# Through the public URL, not 127.0.0.1:8082 — that way a broken handle_path or
# a tunnel that lost the hostname fails here instead of in a player's browser.

HEALTH=$(curl -sf --connect-timeout 10 --max-time 20 "${SITE}/api/health" || echo "")

case "$HEALTH" in
    *'"status":"ok"'*'"database":true'*)
        echo "  ✓ ${SITE}/api/health → ok, database up"
        ;;
    "")
        fail "${SITE}/api/health did not answer — check the container and the Caddy handle_path"
        ;;
    *)
        fail "${SITE}/api/health answered but not healthy: ${HEALTH}"
        ;;
esac
