---
name: deploy
description: Deploy the gridironpicks.us frontend, or roll it back. Handles lint, typecheck, build, atomic promotion with auto-rollback, and one-step rollback. Use when the user asks to deploy, ship, push the site live, or roll back.
---

# Deploy — gridironpicks.us

Build → promote → rollback, with an atomic symlink swap at the centre.

Only the **frontend** goes through this skill. The API is a container:
`docker compose -f ~/Applications/gridiron/docker-compose.yml up -d --build`, or
`srv restart gridiron`.

## Directory layout on the server

```
/var/www/gridiron/
  builds/
    build-<git-hash>-<dist-fp>/   ← versioned build dirs (keep 3)
  current                 → symlink → builds/build-<hash>   (live)
  previous                → symlink → builds/build-<hash>   (for rollback)
```

Caddy serves `gridironpicks.us` from `/var/www/gridiron/current`, and sends
`/api/*` to the container on `127.0.0.1:8082`.

There is no preview host. A deploy goes straight to production and is judged by a
smoke test that rolls it back automatically if it fails — which is the reason the
`previous` symlink is written _before_ `current` moves.

## One-time setup

```bash
.pi/skills/deploy/scripts/setup.sh
```

Checks that `/var/www/gridiron/builds` exists and is writable, and prints what to
do if it is not:

```bash
sudo mkdir -p /var/www/gridiron/builds && sudo chown -R josh:josh /var/www/gridiron
```

## Workflows

### Deploy

```bash
.pi/skills/deploy/scripts/deploy.sh
```

**When to use:** the user asks to deploy, ship, or push the site live.

**What it does:**

1. Aborts if the git working tree is dirty — tell the user exactly which files
2. `pnpm lint`, `pnpm --filter @gridiron/web typecheck`, `pnpm build:web` — aborts on any failure
3. rsyncs `apps/web/dist/` to `builds/build-<git-hash>-<dist-fp>/`, where `<dist-fp>`
   is a hash of the built output — so the same commit built twice gets its own
   directory rather than being rsynced over while production serves it
4. Writes `deploy.json` (hash, message, timestamp) into the build dir
5. Points `previous` at the outgoing build, then swaps `current` — in that order
6. Prunes to the newest 3 builds, never touching `current` or `previous`
7. Smoke-tests `https://gridironpicks.us`: HTTP 200, body looks like the app, and
   `/api/health` reports the database up
8. **Auto-rolls back and exits non-zero** if any part of the smoke test fails

**Report to the user:** commit hash and message, the URL, smoke test result, and
the build saved for rollback. On failure, the full output and the fact that it
rolled back on its own.

### Roll back

```bash
.pi/skills/deploy/scripts/rollback.sh
```

**When to use:** the user says production is broken. Act immediately — don't ask
for confirmation first.

Swaps `current` and `previous`, then smoke-tests. Running it twice returns you to
where you started, so a rollback is never a one-way door.

## Scripts reference

```
.pi/skills/deploy/
├── SKILL.md              ← this file
└── scripts/
    ├── setup.sh          ← one-time server setup check
    ├── deploy.sh         ← lint, build, promote, smoke test, auto-rollback
    ├── rollback.sh       ← swap back to the previous build
    └── smoke.sh          ← shared smoke test, used by both of the above
```
