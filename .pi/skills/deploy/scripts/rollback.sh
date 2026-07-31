#!/usr/bin/env bash
# rollback.sh — swap gridironpicks.us back to the previous build.
#
# Run it twice and you are back where you started: the swap is symmetric, so a
# rollback is never a one-way door.
set -euo pipefail

DEPLOY_ROOT="/var/www/gridiron"
CURRENT_LINK="${DEPLOY_ROOT}/current"
PREVIOUS_LINK="${DEPLOY_ROOT}/previous"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CURRENT_BUILD=$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "")
PREVIOUS_BUILD=$(readlink -f "$PREVIOUS_LINK" 2>/dev/null || echo "")

if [ -z "$PREVIOUS_BUILD" ] || [ ! -d "$PREVIOUS_BUILD" ]; then
    echo "ERROR: no previous build to roll back to."
    echo "  ${PREVIOUS_LINK} → ${PREVIOUS_BUILD:-<unset>}"
    exit 1
fi

if [ "$CURRENT_BUILD" = "$PREVIOUS_BUILD" ]; then
    echo "ERROR: current and previous are the same build ($(basename "$CURRENT_BUILD"))."
    echo "There is nothing to roll back to."
    exit 1
fi

echo "=== Rolling back gridironpicks.us ==="
echo "  from: $(basename "$CURRENT_BUILD")"
echo "  to:   $(basename "$PREVIOUS_BUILD")"
echo ""

ln -sfn "$CURRENT_BUILD" "$PREVIOUS_LINK"
ln -sfn "$PREVIOUS_BUILD" "$CURRENT_LINK"

sleep 1
echo "→ Smoke testing..."
if ! bash "${SCRIPT_DIR}/smoke.sh"; then
    echo ""
    echo "⚠ The rolled-back build does not pass the smoke test either."
    echo "  That points at the API container or Caddy rather than the frontend:"
    echo "    docker compose -f ~/Applications/gridiron/docker-compose.yml ps"
    echo "    journalctl -u caddy -n 50"
    exit 1
fi

echo ""
echo "✓ Rolled back"
echo "  Now serving: $(basename "$PREVIOUS_BUILD")"
if [ -f "${CURRENT_LINK}/deploy.json" ]; then
    echo "  $(python3 -c "import json;d=json.load(open('${CURRENT_LINK}/deploy.json'));print(d['hash']+': '+d['message'])" 2>/dev/null || true)"
fi
