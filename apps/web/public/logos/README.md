# NFL team logos

Primary 500×500 NFL team logos, one per canonical team code, named in lowercase
(e.g. `kc.png`, `lv.png`, `gb.png`).

- **Source:** ESPN's CDN, `https://a.espncdn.com/i/teamlogos/nfl/500/<code-lower>.png`
- **Fetched:** 2025-08-01
- **Why local:** keeps the pick page off a third-party CDN at runtime; these are
  static assets bundled and served from our own origin, so a slot card's logo
  loads with the bundle instead of depending on `a.espncdn.com` being up.

The team codes match `packages/schema/src/seed/teams.ts`. Relocated franchises
resolve to their current canonical code before lookup, so there is no `oak.png`
or `stl.png` — an `OAK` alias always becomes `LV` by the time it's a `teamId`.

Re-fetch a single team with:

```sh
curl -o apps/web/public/logos/<code-lower>.png \
  https://a.espncdn.com/i/teamlogos/nfl/500/<code-lower>.png
```