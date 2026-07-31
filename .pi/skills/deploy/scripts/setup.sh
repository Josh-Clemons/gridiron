#!/usr/bin/env bash
# setup.sh — one-time server preparation for the gridironpicks.us frontend.
#
# Checks rather than does: the one step that needs root is left for a human to
# run, so this script never asks for a password.
set -uo pipefail

DEPLOY_ROOT="/var/www/gridiron"
BUILD_DIR="${DEPLOY_ROOT}/builds"
COMPOSE="/home/josh/Applications/gridiron/docker-compose.yml"

echo "=== gridironpicks.us — deploy prerequisites ==="
echo ""

READY=0

# ── Deploy root ─────────────────────────────────────────────────────────────

if [ -d "$BUILD_DIR" ] && [ -w "$BUILD_DIR" ]; then
    echo "✓ ${BUILD_DIR} exists and is writable"
else
    READY=1
    echo "✗ ${BUILD_DIR} is missing or not writable. Run:"
    echo ""
    echo "    sudo mkdir -p ${BUILD_DIR} && sudo chown -R \"\$(whoami)\":\"\$(whoami)\" ${DEPLOY_ROOT}"
    echo ""
fi

# ── API container ───────────────────────────────────────────────────────────

if [ "$(docker inspect --format '{{.State.Status}}' gridiron-api 2>/dev/null)" = "running" ]; then
    echo "✓ gridiron-api is running"
else
    READY=1
    echo "✗ gridiron-api is not running. Start it with:"
    echo ""
    echo "    docker compose -f ${COMPOSE} up -d --build"
    echo ""
fi

if curl -sf --max-time 5 http://127.0.0.1:8082/health >/dev/null 2>&1; then
    echo "✓ API answers on 127.0.0.1:8082/health"
else
    READY=1
    echo "✗ Nothing healthy on 127.0.0.1:8082 — check: docker logs gridiron-api"
fi

# ── Edge ────────────────────────────────────────────────────────────────────

if grep -q "gridironpicks.us" /home/josh/Projects/irc/configs/Caddyfile 2>/dev/null; then
    echo "✓ Caddyfile has a gridironpicks.us block"
else
    READY=1
    echo "✗ No gridironpicks.us block in the Caddyfile."
    echo "  It needs handle_path /api/* → 127.0.0.1:8082 as a SIBLING of the static"
    echo "  handler, and try_files {path} /index.html from ${DEPLOY_ROOT}/current."
fi

if grep -q "gridironpicks.us" /home/josh/Projects/irc/configs/cloudflared-jdclemons.yml 2>/dev/null; then
    echo "✓ Tunnel config has a gridironpicks.us ingress entry"
else
    READY=1
    echo "✗ No gridironpicks.us ingress entry in configs/cloudflared-jdclemons.yml"
fi

if host gridironpicks.us >/dev/null 2>&1; then
    echo "✓ gridironpicks.us resolves"
else
    READY=1
    echo "✗ gridironpicks.us does not resolve. Add the CNAME in the Cloudflare"
    echo "  DASHBOARD — not \`cloudflared tunnel route dns\`, whose cert is scoped to"
    echo "  mn4x4.org and will silently create a junk record in the wrong zone."
    echo "  gridironpicks.us zone → apex CNAME →"
    echo "  7982b60d-d3a2-4ef7-8716-3e21a6f30e2f.cfargotunnel.com, proxied."
fi

echo ""
if [ "$READY" -eq 0 ]; then
    echo "All prerequisites met — .pi/skills/deploy/scripts/deploy.sh is ready to run."
else
    echo "Fix the ✗ items above, then run this again."
fi
exit "$READY"
