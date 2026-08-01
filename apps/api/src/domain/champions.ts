import type { Champions, Pool } from '@gridiron/contracts';
import type { ChampionRow } from '../data/champions';

/** Regular season first — it is the older list and the one people mean by default. */
const POOL_ORDER: readonly Pool[] = ['regular', 'playoff'];

/**
 * Group the honours board by pool, then by year, newest first.
 *
 * Every year between a pool's first and last gets an entry, even when nobody won it.
 * The importer stores no row for a year with no champion — `display_name` is NOT NULL,
 * so any placeholder would be a fabricated winner — and the 2018 playoff pool really
 * did play no game. Filling the range here is what turns that absence into a visible
 * gap in the list instead of two adjacent years that quietly skip one.
 *
 * A pool with no rows at all is left out entirely: a league that has never imported a
 * workbook should see nothing, not an empty playoff section.
 */
export function buildChampions(rows: readonly ChampionRow[]): Champions {
  const pools = POOL_ORDER.map((pool) => {
    const inPool = rows.filter((row) => row.pool === pool);
    return { pool, years: yearsDescending(inPool) };
  }).filter((entry) => entry.years.length > 0);

  return { pools };
}

function yearsDescending(rows: readonly ChampionRow[]): Champions['pools'][number]['years'] {
  if (rows.length === 0) return [];

  const years = rows.map((row) => row.year);
  const newest = Math.max(...years);
  const oldest = Math.min(...years);

  return Array.from({ length: newest - oldest + 1 }, (_, index) => {
    const year = newest - index;
    return {
      year,
      champions: rows
        .filter((row) => row.year === year)
        .map((row) => ({
          year: row.year,
          pool: row.pool,
          displayName: row.displayName,
          memberId: row.memberId,
          totalPoints: row.totalPoints,
          note: row.note,
        })),
    };
  });
}
