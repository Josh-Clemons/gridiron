import { champions } from '@gridiron/schema';
import { asc, desc, eq } from 'drizzle-orm';
import type { Deps } from '../deps';

export interface ChampionRow {
  readonly year: number;
  readonly pool: 'regular' | 'playoff';
  readonly displayName: string;
  readonly memberId: number | null;
  readonly totalPoints: number | null;
  readonly note: string | null;
}

/**
 * The league's honours board, newest year first.
 *
 * Co-champions of the same year come back in name order so a tie reads the same way
 * every time. The importer writes this table from the workbook's `Grid Iron Winners`
 * sheet; nothing else does, which is why there is no write path here.
 */
export function listChampions(deps: Deps, leagueId: number): Promise<ChampionRow[]> {
  return deps.db
    .select({
      year: champions.year,
      pool: champions.pool,
      displayName: champions.displayName,
      memberId: champions.memberId,
      totalPoints: champions.totalPoints,
      note: champions.note,
    })
    .from(champions)
    .where(eq(champions.leagueId, leagueId))
    .orderBy(desc(champions.year), asc(champions.displayName));
}
