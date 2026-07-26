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
```

`apps/api`, `apps/web` and `apps/importer` arrive in later phases.

`packages/rules` is deliberately the first thing built and has no dependencies. Every
game rule is a pure function over plain data, so the API can enforce it server-side and
the web app can call the _same code_ to grey out illegal picks before they're made.
There is exactly one place a rule is written.

## Commands

```bash
pnpm install
pnpm check          # lint + typecheck + test
pnpm test:watch
pnpm format
```

## Toolchain

TypeScript 7, Vitest 4, oxlint (with `oxlint-tsgolint` for type-aware rules), Prettier,
pnpm workspaces on Node 24.

oxlint rather than ESLint because TypeScript 7 is outside the peer range typescript-eslint
currently supports, and oxlint's type-aware companion is built on the same typescript-go
compiler that TypeScript 7 ships.
