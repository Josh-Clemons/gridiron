# Gridiron

An NFL pick'em app for a pool that has run since 2007.

Each week you pick three teams to win straight up — one each at **Win (5 pt)**,
**Place (3 pt)** and **Show (1 pt)**. All three winning is a **Trifecta**, worth two
bonus points. A team may be used only once per slot per season, so at most three times
a year. Ties count as losses, you can't take both sides of one game, and each pick
locks at its own kickoff.

This replaces the earlier `gridiron-react` / `gridiron_java` pair. The full phased plan
lives at `~/.claude/plans/rustling-floating-pike.md`.

## Layout

```
packages/rules/     pure validation + scoring engine, zero I/O
packages/schema/    Drizzle schema, migrations, seed data
packages/contracts/ Zod request/response schemas shared by client and server
apps/api/           Hono API on Node 24
apps/web/           React 19 + Vite + MUI, the pick page
apps/importer/      operator CLI that loads the commissioner's spreadsheet
```

`packages/rules` is deliberately the first thing built and has no dependencies. Every
game rule is a pure function over plain data, so the API can enforce it server-side and
the web app can call the _same code_ to grey out illegal picks before they're made.
There is exactly one place a rule is written.

## Commands

```bash
pnpm install
pnpm check          # lint + typecheck + test
pnpm dev            # API on :8083 and the web app on :5173, together
pnpm dev:api        # just one of them
pnpm dev:web
pnpm test:unit      # rules + contracts, milliseconds
pnpm test:web       # component tests, jsdom, also milliseconds
pnpm test:api       # integration tests, needs Docker
pnpm test:importer  # golden workbooks + rejection cases, needs Docker
pnpm test:watch
pnpm format
```

### Database

```bash
cp .env.example .env
pnpm db:up          # start Postgres in Docker (port 5433)
pnpm db:migrate
pnpm db:seed        # teams, aliases, seasons — idempotent
pnpm db:reset       # wipe and rebuild from nothing
pnpm db:generate    # regenerate migrations after editing the schema
```

The dev database listens on **5433**, not 5432, because this machine already runs a
host Postgres on the default port — and production is a third database on **5434**.
The dev API is on **8083** for the same reason: 8082 belongs to the production
container, which runs continuously.

Game rules are enforced in three places, deliberately: the UI greys out illegal picks,
the API rejects them, and the database has the constraints to back it up. In
particular, "a team may be used once per slot per season" is a unique index, so a bug
in the write path still can't corrupt the data.

## API

Session cookies (httpOnly, `SameSite=Lax`, server-side and revocable — no JWT), Argon2id
password hashing, and Zod validation at every boundary.

```
POST   /auth/register | /auth/login | /auth/logout
GET    /auth/me
POST   /auth/forgot-password | /auth/reset-password
GET    /leagues                       leagues you belong to
POST   /leagues                       create one, you become owner
GET    /leagues/preview?code=XXXXXXXX what an invite code shows before joining
POST   /leagues/join                  join, optionally claiming an imported roster slot
GET    /leagues/:id/members
POST   /leagues/:id/leave
GET    /leagues/:id/board?week=N      one week: games, your picks, everyone's totals
PUT    /leagues/:id/picks/:week/:slot { "teamId": "KC" }
DELETE /leagues/:id/picks/:week/:slot
GET    /leagues/:id/standings?week=N
GET    /leagues/:id/usage             teams left in each of Win/Place/Show
GET    /teams                         the 32 teams and their names, no session needed
GET    /health
```

`?season=YYYY` is accepted anywhere a league is addressed and defaults to the newest
season, so the history views in later phases are these same endpoints.

Two things are structural rather than checked-by-convention. The acting member is
resolved from the session cookie and never read from a request body, and every write
re-runs `packages/rules` against real schedule data before anything is stored — an
invalid pick is rejected, never saved. Both were real production bugs in the old app.

Imported players are `league_members` rows with no `user_id`. Someone joining with the
invite code can claim one and inherit its picks, which is how the 72-player spreadsheet
league migrates to the site one person at a time.

Password reset builds and sends a real message through a `Mailer` interface. Production
sends through Resend's HTTP API — one `fetch`, no SMTP client — and development prints
the link to the log. Production refuses to boot on any other transport, because the
console one writes a working reset link into the journal and mails nobody. Build the
mailer with `mailerFor(config)` rather than `createMailer` directly: passing a transport
without its credentials type-checks and then throws only under `resend`, which is to say
only in production.

Integration tests run against a real Postgres in a Testcontainer — migrations and seed
included, because constraints like the season-reuse index only exist in the database.

## Web app

React 19 + Vite + TypeScript, TanStack Router and Query v5, MUI 7 with a real theme —
the colours live in `apps/web/src/theme.ts` and nowhere else. Mobile-first, because
picks get made on phones.

The pick page is the centrepiece and it has **no save button**. Choosing a team fires a
per-slot `PUT` with an optimistic cache update; there is no dirty state to lose. Illegal
teams are listed but greyed out with the rule they break written underneath, and that
check is `availableTeamsFor` from `packages/rules` — the same function the API runs
before it writes, so what's unavailable in the browser is exactly what the server would
refuse. The wording comes from `describeRejection`, so the tooltip and the API error are
one sentence maintained in one place.

Locks tick from `board.now`, the server's own clock, not the device's. Kickoffs are per
game, so a Thursday pick freezes while the rest of the week stays open.

One week at a time is load-bearing: 72 members × 18 weeks is ~3,900 picks, and the board
response is a few kilobytes of games, your three picks and everyone's totals as
integers. Standings are aggregated server-side; no member's picks are ever sent to
another member's browser.

The dev server proxies `/api` to the API with the prefix stripped, which is the same
shape Caddy serves in production — so the session cookie is first-party in both, and
`SameSite=Lax` means what it says. Production does the stripping with Caddy's
`handle_path /api/*`; with a plain `handle` the API would see `/api/auth/login` and 404
on every call.

## NFL data

Schedules and results come from ESPN's public scoreboard endpoint, which is
undocumented, unauthenticated and unversioned. Every field we read is named in one Zod
schema in `apps/api/src/sync/espn.ts`, so a shape change is a parse error in one file
with a message naming the field — not silently-zero scores in week 6. An empty week is
an error, never "no games".

```bash
pnpm sync schedule                 # every week of the current season
pnpm sync schedule --season 2020   # backfill a finished season, results included
pnpm sync results                  # the live week and the one before it
pnpm sync results --week 7
```

Cron runs exactly these commands — see `scripts/crontab.example` — so the automated
path and the manual one can't diverge. Every run is idempotent: rows that already match
are left alone, and re-running after a failure is always safe. Failures exit non-zero
and alert. The alerter can post to Matrix, but no token is configured yet, so today a
failure goes to stderr and cron mails it to the local user.

Nothing incrementally mutates a score. Standings are derived from `games` and `picks` on
read, so **writing a result _is_ the rescore**, and a result ESPN later corrects simply
corrects. A game that disappears from the feed — a postponement — is counted and
reported, never deleted, because deleting it would silently void everyone's picks on it.

Loaded so far: 2020 (17 weeks, 256 games, one tie), 2023, 2025, and the full 2026
schedule.

## Spreadsheet import

Most picks still arrive on the commissioner's workbook, the same file copied forward
since 2007. `apps/importer` loads it. It is an operator CLI, not a feature — players who
want to pick in the app just pick in the app, and the import shrinks as they do.

```bash
pnpm importer --file "Grid Iron- 2026.xlsx" --league 1 --season 2026
pnpm importer --file "Grid Iron- 2026.xlsx" --league 1 --season 2026 --apply
pnpm importer --file "Grid Iron- 2025.xlsx" --league 1 --winners
```

**Dry run by default.** Every stage except the write runs either way, so the report is
never a guess about what `--apply` would do. The weekly loop is: get the workbook, run
it, read the report, run it again with `--apply`. It exits non-zero when anything was
rejected or conflicted, so a scripted run that ends up partial is noticed.

Four stages:

- **Parse.** Sheets are found by name, never by index — the workbooks disagree on
  ordering and 2020 has no `Grid Iron Winners` at all. The week count comes from the
  header width (17 in 2020, 18 since), and the layout is asserted column by column, so a
  2026 file that has drifted stops the run instead of importing picks a week out of
  place. Reads `.xlsx` and legacy BIFF8 `.xls`.
- **Validate.** Every pick goes through `packages/rules` — the same `validatePick` the
  API calls. The importer is not a privileged back door. Its one documented exception is
  the kickoff lock: the workbook _records_ picks collected before kickoff rather than
  making new ones, so enforcing it would reject the current week on any run made after
  Thursday night. Rejection is per pick; the slot is left empty, which scores 0, and the
  player's other picks and everyone else import normally.
- **Reconcile.** A slot already holding a pick the player made in the app, for a
  different team, imports **neither** and is reported — a transcription should never
  silently overwrite what someone entered themselves. The `Selection History` tab is
  cross-checked as a genuine second opinion at ~99% agreement, and the sheet's own
  arithmetic is compared against what the app computes from ESPN results.
- **Apply.** Idempotent upsert stamped `source='import'`, in one transaction. Scores are
  never written; the app recomputes them. Applying the same file twice leaves the
  database byte-identical, including timestamps.

Unknown names and unknown team tokens **abort the whole run** rather than being guessed
at, because a silent mis-association files one player's picks under another's name.
Adding a player is one deliberate line in `apps/importer/aliases/players.aliases.json`.

The 2020, 2023 and 2025 workbooks are committed as golden fixtures with their expected
findings pinned, alongside `games.json` — a dump of the real ESPN schedules for those
seasons, so the tests need neither the network nor a local database.

## Deployment

Live at **https://gridironpicks.us**, self-hosted. The API and Postgres are containers;
the frontend is built on the host and served as static files by Caddy, which also
strips `/api` and proxies it to the container. Public traffic arrives over an existing
Cloudflare tunnel — no inbound port is open.

```bash
# API — build and restart the stack
docker compose -f ~/Applications/gridiron/docker-compose.yml up -d --build

# Frontend — build, promote atomically, smoke test, auto-rollback on failure
.pi/skills/deploy/scripts/deploy.sh
.pi/skills/deploy/scripts/rollback.sh
```

`deploy/docker-compose.yml` is the source of truth and is symlinked to
`~/Applications/gridiron/docker-compose.yml`, so editing it here is deploying it —
the same convention `/etc/caddy/Caddyfile` follows. Secrets live in
`~/.config/gridiron.env` at mode 0600 and are never in the repo. Migrations run as a
one-shot container that must exit 0 before the API starts.

Both compose files pin an explicit project name — `gridiron` for production,
`gridiron-dev` here. Without them compose derives the name from the directory, and both
directories are called `gridiron`; two same-named projects that each define a `db`
service will adopt and recreate each other's containers.

The importer runs against production through the same image, behind a compose profile
so it never starts on its own:

```bash
docker compose -f ~/Applications/gridiron/docker-compose.yml \
  run --rm gridiron-importer --file /workbooks/"Grid Iron- 2026.xlsx" --league 1 --season 2026
```

Workbooks go in `~/gridiron-workbooks`, mounted read-only. Nightly `pg_dump` is step 3
of `~/Projects/irc/scripts/backup.sh`; the league's picks exist nowhere else.

## Toolchain

TypeScript 7, Vitest 4, oxlint (with `oxlint-tsgolint` for type-aware rules), Prettier,
pnpm workspaces on Node 24.

oxlint rather than ESLint because TypeScript 7 is outside the peer range typescript-eslint
currently supports, and oxlint's type-aware companion is built on the same typescript-go
compiler that TypeScript 7 ships.
