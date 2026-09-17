# gridiron — Agent Context

> This file is auto-loaded by pi alongside the global agent guidelines
> at `~/.pi/agent/AGENTS.md`. Keep this file focused on project-specific
> context only — behaviour guidelines live in the global file.

---

## Identity

| Field         | Value                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project       | `gridiron`                                                                                                                                              |
| Agent account | `@gridiron-agent:jdclemons.dev`                                                                                                                         |
| Agent room    | `#gridiron:jdclemons.dev` (in Development space)                                                                                                        |
| Role          | Builds and maintains the Gridiron NFL pick'em app — rules engine, Hono API, React web app, ESPN sync, spreadsheet importer, and self-hosted deployment. |
| Created       | 2026-08-12                                                                                                                                              |

---

## Project Context

### What this project does

Gridiron is an NFL pick'em app for a pool running since 2007. Each week players
pick three teams straight up — Win (5 pt), Place (3 pt), Show (1 pt) — and a
Trifecta earns two bonus points. This is the successor to the retired
`gridiron-react` / `gridiron_java` pair. Live at https://gridironpicks.us.

### Stack & key technologies

- **Runtime:** Node 24, TypeScript 7, pnpm workspaces
- **API:** Hono; session cookies (httpOnly, `SameSite=Lax`), Argon2id hashing, Zod validation at every boundary
- **Web:** React 19 + Vite + TanStack Router/Query + MUI 7, mobile-first
- **Data:** Drizzle ORM + Postgres; dev on **5433**, production on **5434**
- **Sync:** ESPN public scoreboard endpoint (undocumented, unauthenticated) behind a strict Zod schema
- **Quality:** Vitest 4, oxlint (type-aware), Prettier
- **Deploy:** Docker compose + Caddy + Cloudflare tunnel (no inbound ports)

### Directory structure

```
packages/rules/     pure validation + scoring engine, zero I/O — the single source of truth for every game rule
packages/schema/    Drizzle schema, migrations, seed data
packages/contracts/ Zod request/response schemas shared by client and server
apps/api/           Hono API on Node 24
apps/web/           React 19 + Vite + MUI, the pick page
apps/importer/      operator CLI that loads the commissioner's spreadsheet
deploy/             docker-compose.yml (source of truth), symlinked into ~/Applications/gridiron/
.pi/skills/deploy/  deploy / rollback / setup / smoke scripts
```

### Conventions

- **Rules live in exactly one place** — `packages/rules`. The API and the web app
  call the same code; never re-implement a rule in the UI or API.
- **Importer is dry-run by default** — every stage except the write runs either
  way; `--apply` is explicit.
- **Sync and import are idempotent** — re-running after a failure is always safe.
- **Secrets never enter the repo** — they live in `~/.config/gridiron.env` (0600).
- **Source-of-truth configs are symlinked into place** (e.g. `deploy/docker-compose.yml`
  → `~/Applications/gridiron/docker-compose.yml`); editing the repo file deploys it.
- **Branch strategy:** phase-named feature branches (e.g. `phase-6-hall-of-fame`).
- `pnpm check` (lint + typecheck + test) must pass before finishing work.

---

## Collaborators

Other agents this project interacts with:

| Agent | Room               | Relationship                                                                                                                                        |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| irc   | #irc:jdclemons.dev | Owns server infra (Caddy, Cloudflare tunnel, backups — including the nightly `pg_dump` of the production DB). Use `/skill:mn4x4-ops` for ops tasks. |

> To collaborate: invite the other agent to this project's room temporarily,
> or create `#gridiron-<other>:jdclemons.dev` for an ongoing relationship.
> Update this table and notify both agents' AGENTS.md when collaborators are added.

---

## Communication

- **Primary room:** `#gridiron:jdclemons.dev`
- **Urgent issues:** post to `#alerts:jdclemons.dev` first, then follow up here
- **Cross-project:** `#general:jdclemons.dev` for announcements spanning projects

### Steering from Element

Send these commands directly in `#gridiron:jdclemons.dev`:

| Command                     | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `?model [list\|<name>]`     | List or switch the active model                                       |
| `?thinking <level>`         | `off` / `low` / `medium` / `high`                                     |
| `?status`                   | Model, context %, message count, session age                          |
| `?reset`                    | Force a session rotation now                                          |
| `?abort`                    | Cancel the current task                                               |
| `?backend [pi\|claude]`     | Switch this agent's backend (pi = token-based, claude = subscription) |
| `?backend-all [pi\|claude]` | Switch all agents' backend at once                                    |
| `?help`                     | Full command list                                                     |

---

## Trust Boundaries

This agent only processes Matrix messages from users listed in `trustedSenders` in `~/.pi/agents.json`.
Messages from bots or automated senders are silently ignored.

To allow another agent to message this one directly, add its Matrix user ID to `trustedSenders`.

---

## Out of Scope

- Do not make changes outside `/home/josh/Projects/gridiron` without explicit instruction
- Do not interact with other agents' Matrix rooms unless invited
- Do not wipe or reset the production database (Postgres on 5434); the league's picks exist nowhere else
- Do not touch `~/Applications/gridiron/` (production) or `~/gridiron-workbooks/` (read-only input) without explicit approval
- Server infra (Caddy, Cloudflare tunnel, backups) is owned by the irc agent — coordinate, don't duplicate
