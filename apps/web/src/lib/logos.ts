/**
 * Resolve a team code to its bundled logo URL.
 *
 * Logos live in `apps/web/public/logos/` as `<lowercase-code>.png` (see that
 * directory's README for the source). Kept off the `Team` contract on purpose: it's
 * a pure function of the code, so storing it would just be a second source of truth
 * that the API would have to keep in lockstep with the static files. A code change
 * is the only thing that ever forces a logo change, and that already can't happen
 * without touching code.
 */
export function teamLogoUrl(code: string): string {
  return `${import.meta.env.BASE_URL}logos/${code.toLowerCase()}.png`;
}
