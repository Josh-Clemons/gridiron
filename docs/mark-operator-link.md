# Mark Swan operator link — design

> Status: **mostly built (September 2026).** The tutorial shipped, simplified from the
> design below per the build conversation: one-liner steps, one tour with a
> commissioner section, a server-side seen flag (`users.has_seen_tour`), a "show me
> around again" item in Settings, and a reusable `GuidedTour` component
> (`apps/web/src/components/GuidedTour.tsx`, content in `apps/web/src/lib/tour.ts`).
>
> The **authentication design changed outright: there is no magic link.** Mark is
> the league's commissioner (`league_members.role = 'owner'`) with a normal app
> account, and Josh holds a platform admin flag (`users.is_admin`, enforced by
> `isCommissioner` in `apps/api/src/data/leagues.ts`) that grants owner powers in
> any league he belongs to — never bypassing membership. The magic link + short
> code below remains an option, not a plan.

## The problem

Mark Swan originated the game and has managed the commissioner's spreadsheet
for many years. Today the workbook reaches the app by email to Josh, who runs
the CLI importer. Mark should never need the CLI, the repo, or an operator
explanation — the whole feature is a front door to the tools that already exist.

**The spreadsheet remains core to how Mark runs the league.** This feature is
not about replacing it. It removes Josh from the weekly loop, nothing more.

## Scope

| Question           | Decision                                                 |
| ------------------ | -------------------------------------------------------- |
| What does Mark do? | Workbook upload, download, and validation — nothing else |
| Pick corrections   | Mark fixes the spreadsheet and re-uploads it             |
| Season rollover    | Stays with Josh                                          |
| New members        | Sign up through Mark only — never through the app        |
| Commissioner UI    | The existing Workbooks tab; no new admin UI is built     |
| Auth               | Magic link + short code (below)                          |

What already exists and is therefore out of scope: the Workbooks tab
(upload → validation report → apply → download), `GET /admin/export`
(export in the same shape as the uploaded sheet), and the hardened import
seam (one import per league at a time, the importer's own sentence on
failure).

### The correction loop, and its one edge

Corrections are spreadsheet-first: Mark fixes the error in his sheet and
re-uploads. Most picks are `import`-source, so this is the normal path and the
validation report tells him what it caught.

The one edge: the importer will **not** override a member's own `app` pick. If
the sheet disagrees with a pick a member made in the app, the report flags a
**conflict**, imports neither, and leaves the app pick byte-identical. Mark
does not need to understand this beyond the tutorial's one-liner: _if the
report says conflict, that's a member's own app pick — tell Josh._

## Authentication

**Deferred — not built, and not missed yet.** Mark signs in with a normal app
account (email + password). The magic link below was designed before the simpler
commissioner-account + platform-admin arrangement was chosen; it is kept here for
the record in case Mark ever asks for it.

Mark clicks a link and enters a short code. That's the entire login
experience.

- **The link carries a long random token** (like the league invite codes
  already in the app). Clicking it starts a normal httpOnly session — the
  token is not a persistent credential, and bookmarking the site works after.
- **The code is randomly generated and short** — 4–6 digits. It exists because
  two steps beat one: it defends against the realistic leak paths for a link
  (email forwarding, browser history, server logs). A guessable code like the
  league year would reduce this to link-only, so the code is random.
- **Rate-limited entry.** A short code is brute-forceable without a
  rate limit on the code-entry endpoint. This is a build requirement, not a
  nice-to-have.
- **Rotatable.** Josh can regenerate the pair, exactly like
  `regenerateInvite` today; the old link and code simply stop working.

Open implementation detail: whether the code rides in the same email as the
link (guards history/logs only) or is given out-of-band (genuine two-factor).
Either is defensible; decide at build time.

## The tutorial

A first-visit walkthrough on a **reusable `GuidedTour` component**: an array
of steps (anchor element + title + sentence), a "seen this" flag so it shows
once, and a persistent **"show me around again"** link. Non-technical users do
not retain a tour they saw once in September.

The tour has three tiers — one deep, two shallow:

**Tier 1 — the loop Mark lives in (guided spotlight steps):**

1. Upload the spreadsheet
2. Read the validation report — it tells you what it caught
3. Apply — after confirming what the report found
4. Download — your own file back, or a fresh export in the same shape
5. The conflict one-liner: _if the report says conflict, that's a member's own
   app pick — tell Josh_

**Tier 2 — one step each, no more ("so you know it exists"):**

- **Picks tab** — everyone's picks are visible here; the spreadsheet stays
  your source of truth
- **Roster tab** — everyone in the league is listed here; new players appear
  when they first show up in your spreadsheet
- **League tab** — league settings live here

**Tier 3 — a closing "what else is here" note (sentences, not steps):**

The pick page, standings, and champions are what members see. Mark is a player
too, so if he ever wants to make his picks in the app instead of the sheet,
the same pages are his to use.

Structure over content: Tier 1 is the guided tour; Tiers 2–3 are a single
"what else is here" step or a short static panel. One deep walkthrough of the
thing he must do, plus a map of everything else.

## Explicitly out of scope

- Season rollover — Josh's job, stays that way
- Member join flow — Mark signs up new members via the spreadsheet
- Any change to the conflict rule (a member's `app` pick is never overridden
  by the sheet)
- Touching the import seam — it is hardened and idempotent as-is
