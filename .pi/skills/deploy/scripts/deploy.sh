#!/usr/bin/env bash
# deploy.sh — build the frontend and promote it to gridironpicks.us
#
# Requires a clean git working tree and /var/www/gridiron owned by the current
# user. There is no preview stage: this promotes straight to production and
# rolls itself back if the smoke test fails.
set -euo pipefail

DEPLOY_ROOT="/var/www/gridiron"
BUILD_DIR="${DEPLOY_ROOT}/builds"
CURRENT_LINK="${DEPLOY_ROOT}/current"
PREVIOUS_LINK="${DEPLOY_ROOT}/previous"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Four levels up, not three: scripts → deploy → skills → .pi → repo root.
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"

cd "$PROJECT_DIR"

# ── 1. Deploy root sanity check ─────────────────────────────────────────────

if [ ! -d "$BUILD_DIR" ] || [ ! -w "$BUILD_DIR" ]; then
    echo "ERROR: ${BUILD_DIR} is missing or not writable."
    echo "Run .pi/skills/deploy/scripts/setup.sh first."
    exit 1
fi

# ── 2. Require a clean git working tree ─────────────────────────────────────

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: Uncommitted changes detected. Commit before deploying, so what's"
    echo "live is a commit you can name."
    echo ""
    git status --short
    exit 1
fi

# ── 3. Git metadata ─────────────────────────────────────────────────────────

GIT_HASH=$(git rev-parse --short HEAD)
GIT_MSG=$(git log -1 --pretty=%s)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== Deploy gridironpicks.us: ${GIT_HASH} ==="
echo "    ${GIT_MSG}"
echo ""

# ── 4. Lint, typecheck, build ───────────────────────────────────────────────

echo "→ Linting..."
pnpm lint

echo ""
echo "→ Typechecking the web app..."
# Only the web package: this script ships apps/web/dist and nothing else, and a
# type error in the importer is not a reason to block a frontend fix. `pnpm check`
# is the gate for everything.
pnpm --filter @gridiron/web typecheck

echo ""
echo "→ Building..."
pnpm build:web

# ── 5. Sync to a versioned build dir ────────────────────────────────────────

# Named by commit *and* a fingerprint of the output, so the same commit built
# twice never rsyncs over the directory production is currently serving.
DIST_FP=$(find apps/web/dist -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -c1-8)
BUILD_NAME="build-${GIT_HASH}-${DIST_FP}"
BUILD_PATH="${BUILD_DIR}/${BUILD_NAME}"

echo ""
echo "→ Syncing apps/web/dist/ → ${BUILD_PATH}/"
mkdir -p "$BUILD_PATH"
rsync -a --delete apps/web/dist/ "${BUILD_PATH}/"

cat > "${BUILD_PATH}/deploy.json" <<EOF
{
  "hash": "${GIT_HASH}",
  "build": "${BUILD_NAME}",
  "message": $(printf '%s' "$GIT_MSG" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))"),
  "timestamp": "${TIMESTAMP}",
  "deployed_by": "$(whoami)",
  "environment": "production"
}
EOF

echo "✓ Build synced"

# ── 6. Promote ──────────────────────────────────────────────────────────────

# The -L guard is what makes the first deploy work. `readlink -f` resolves a
# path that does not exist yet to itself rather than failing, so without it
# OUTGOING becomes ".../current" on a fresh server and `previous` is pointed at
# the `current` symlink — a loop that silently breaks the first rollback.
if [ -L "$CURRENT_LINK" ]; then
    OUTGOING=$(readlink -f "$CURRENT_LINK")
else
    OUTGOING=""
fi

if [ "$OUTGOING" = "$BUILD_PATH" ]; then
    echo ""
    echo "Nothing to do — ${BUILD_NAME} is already live."
    exit 0
fi

# `previous` is written first, so the rollback path exists before there is
# anything to roll back from. -n is what keeps ln from following the existing
# symlink and creating a link *inside* the old build directory.
if [ -n "$OUTGOING" ]; then
    ln -sfn "$OUTGOING" "$PREVIOUS_LINK"
fi
ln -sfn "$BUILD_PATH" "$CURRENT_LINK"

echo "→ current → ${BUILD_NAME}"

# ── 7. Prune old builds (keep 3, never current/previous) ────────────────────

echo "→ Pruning old builds..."
CURRENT_BUILD=$([ -L "$CURRENT_LINK" ] && readlink -f "$CURRENT_LINK" || echo "")
PREVIOUS_BUILD=$([ -L "$PREVIOUS_LINK" ] && readlink -f "$PREVIOUS_LINK" || echo "")

mapfile -t ALL_BUILDS < <(ls -dt "${BUILD_DIR}"/build-* 2>/dev/null || true)
if [ "${#ALL_BUILDS[@]}" -gt 3 ]; then
    for old_build in "${ALL_BUILDS[@]:3}"; do
        if [ "$old_build" != "$CURRENT_BUILD" ] && [ "$old_build" != "$PREVIOUS_BUILD" ]; then
            echo "  Removing $(basename "$old_build")"
            rm -rf "$old_build"
        fi
    done
fi

# ── 8. Smoke test, and roll back if it fails ────────────────────────────────

echo ""
echo "→ Smoke testing..."
sleep 1  # let Caddy notice the new symlink target

if ! bash "${SCRIPT_DIR}/smoke.sh"; then
    echo ""
    echo "✗ Smoke test FAILED — rolling back automatically."
    if [ -n "$OUTGOING" ]; then
        ln -sfn "$OUTGOING" "$CURRENT_LINK"
        echo "  current → $(basename "$OUTGOING")"
        if bash "${SCRIPT_DIR}/smoke.sh"; then
            echo "  Rollback verified. Production is on the previous build."
        else
            echo "  ⚠ Rollback did NOT pass the smoke test either — this is not the"
            echo "    new build's fault. Check the container and Caddy:"
            echo "      docker compose -f ~/Applications/gridiron/docker-compose.yml ps"
            echo "      journalctl -u caddy -n 50"
        fi
    else
        echo "  Nothing to roll back to — this was the first deploy."
    fi
    exit 1
fi

# ── 9. Done ─────────────────────────────────────────────────────────────────

echo ""
echo "✓ Deployed to production"
echo "  Commit:   ${GIT_HASH}"
echo "  Message:  ${GIT_MSG}"
echo "  URL:      https://gridironpicks.us"
echo "  Rollback: $([ -n "$OUTGOING" ] && basename "$OUTGOING" || echo 'none — first deploy')"
echo "  Time:     ${TIMESTAMP}"
