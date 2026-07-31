# =============================================================================
#  Gridiron API — production image
#
#  Built from the repo root, not from apps/api:
#      docker compose -f ~/Applications/gridiron/docker-compose.yml build
#  The build context is the whole workspace because the API imports three
#  sibling packages (@gridiron/contracts, /rules, /schema) as `workspace:*`.
#
#  bookworm-slim rather than alpine: @node-rs/argon2 is a native module, and the
#  glibc prebuilds are the well-trodden path. An alpine image needs the musl
#  variant and turns a password hash into a runtime surprise.
#
#  There is no bundler step. The API runs TypeScript directly under tsx, which
#  is how it runs in development — so production executes the same files the
#  tests do, and a source map is never wrong.
# =============================================================================

FROM node:24-bookworm-slim AS deps

# corepack reads `packageManager` from the root package.json, so the pnpm
# version here is the one the lockfile was written with.
RUN corepack enable
WORKDIR /app

# Manifests first, so a source-only change reuses the install layer. Every
# workspace package.json must be present even for a filtered install — pnpm
# resolves the workspace graph before it decides what to fetch.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/rules/package.json packages/rules/
COPY packages/schema/package.json packages/schema/
COPY apps/api/package.json apps/api/
COPY apps/importer/package.json apps/importer/
COPY apps/web/package.json apps/web/

# `apps/web` is deliberately excluded: the frontend is built on the host and
# deployed as static files to /var/www/gridiron, so vite and friends have no
# business in this image. The importer is included — it is how a season of
# history gets loaded, and it needs the same database and rules engine.
#
# Dev dependencies are installed, not pruned: tsx is the runtime and
# @hono/node-server is (accurately) a devDependency of a package that runs
# under tsx.
RUN pnpm install --frozen-lockfile \
    --filter @gridiron/api... \
    --filter @gridiron/importer...

# ---------------------------------------------------------------------------

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV TZ=America/Chicago
# Corepack caches the pnpm it fetches here. The default is under $HOME, which the
# `node` user cannot write — so without this, every container start re-downloads
# pnpm from the registry, making a boot depend on npmjs.org being up.
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app

# The whole installed tree in one layer, rather than a node_modules per package:
# pnpm links dependencies as symlinks into the virtual store at
# `node_modules/.pnpm`, and a package with no dependencies of its own (rules, and
# contracts today) has no `node_modules` directory at all — so an enumerated copy
# both breaks the links and fails on the packages that have nothing to copy.
# Leaving the store behind in the deps stage is what the second stage buys.
COPY --from=deps /app /app

# Source over the top. These merge into the tree above without disturbing the
# installed dependencies beside them.
COPY packages/contracts packages/contracts
COPY packages/rules packages/rules
COPY packages/schema packages/schema
COPY apps/api apps/api
COPY apps/importer apps/importer

# No version pinned here on purpose: with no argument corepack reads
# `packageManager` from the package.json in the working directory, so the pnpm
# baked into the image is by construction the one the lockfile was written with.
RUN corepack enable && corepack prepare --activate && chmod -R a+rX /opt/corepack

# `node` (uid 1000) ships with the image. Nothing here writes to disk — state
# is in Postgres — so the whole tree stays owned by root and read-only to the
# process that runs it.
USER node

EXPOSE 8082

# Hits the real route, which touches the database on purpose: an API answering
# 200 while Postgres is down is the kind of green light that hides an outage.
# No curl in slim, and adding one for this would be the only reason to.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??8082)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/apps/api
# `pnpm exec tsx`, not `pnpm start`: the `start` script passes
# --env-file-if-exists=../../.env, and in the image there is no .env and never
# should be — the container is configured entirely by compose's env_file.
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
