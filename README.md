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
```

`apps/web` and `apps/importer` arrive in later phases.

`packages/rules` is deliberately the first thing built and has no dependencies. Every
game rule is a pure function over plain data, so the API can enforce it server-side and
the web app can call the _same code_ to grey out illegal picks before they're made.
There is exactly one place a rule is written.

## Commands

```bash
pnpm install
pnpm check          # lint + typecheck + test
pnpm dev            # API on http://127.0.0.1:8082
pnpm test:unit      # rules + contracts, milliseconds
pnpm test:api       # integration tests, needs Docker
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
host Postgres on the default port.

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

Password reset builds and sends a real message through a `Mailer` interface whose only
implementations so far print to the log or collect in memory. Choosing a provider in
Phase 5 is one new class.

Integration tests run against a real Postgres in a Testcontainer — migrations and seed
included, because constraints like the season-reuse index only exist in the database.

## Toolchain

TypeScript 7, Vitest 4, oxlint (with `oxlint-tsgolint` for type-aware rules), Prettier,
pnpm workspaces on Node 24.

oxlint rather than ESLint because TypeScript 7 is outside the peer range typescript-eslint
currently supports, and oxlint's type-aware companion is built on the same typescript-go
compiler that TypeScript 7 ships.
