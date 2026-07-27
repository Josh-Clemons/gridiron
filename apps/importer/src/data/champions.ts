import { champions } from '@gridiron/schema';
import { and, eq } from 'drizzle-orm';
import type { Champion, Pool } from '../parse/winners';
import { normalisePlayerName, type Roster } from '../parse/roster';
import type { DbOrTx, Deps } from './deps';
import { loadMembers } from './league';

export interface ChampionOutcome {
  readonly year: number;
  readonly pool: Pool;
  readonly displayName: string;
  readonly totalPoints: number | null;
  /** Whether this champion is a current member of the league. */
  readonly linked: boolean;
  readonly action: 'inserted' | 'updated' | 'unchanged';
}

/**
 * Load the champions list.
 *
 * Names resolve through the roster where they can and are stored verbatim where they
 * cannot: the list runs back to 2007 and most of the early winners never appear in a
 * workbook we can read, which is why `champions.member_id` is nullable. A champion who
 * *is* still in the pool gets linked, so their name on the honours board and their
 * pick history are the same person.
 */
export async function upsertChampions(
  deps: Deps,
  leagueId: number,
  parsed: readonly Champion[],
  roster: Roster,
  apply: boolean,
): Promise<ChampionOutcome[]> {
  const members = await loadMembers(deps.db, leagueId);
  const memberByName = new Map(
    members.map((member) => [normalisePlayerName(member.displayName), member]),
  );
  const now = deps.now();

  const outcomes: ChampionOutcome[] = [];
  const run = async (db: DbOrTx): Promise<void> => {
    for (const champion of parsed) {
      const canonical = roster.resolve(champion.rawName) ?? tidy(champion.rawName);
      const member = memberByName.get(normalisePlayerName(canonical));

      const existing = await db
        .select({
          id: champions.id,
          memberId: champions.memberId,
          totalPoints: champions.totalPoints,
        })
        .from(champions)
        .where(
          and(
            eq(champions.leagueId, leagueId),
            eq(champions.year, champion.year),
            eq(champions.pool, champion.pool),
            eq(champions.displayName, canonical),
          ),
        )
        .limit(1);

      const current = existing[0];
      const memberId = member?.id ?? null;
      let action: ChampionOutcome['action'] = 'inserted';

      if (current !== undefined) {
        const same = current.memberId === memberId && current.totalPoints === champion.totalPoints;
        action = same ? 'unchanged' : 'updated';
      }

      if (apply && action !== 'unchanged') {
        await db
          .insert(champions)
          .values({
            leagueId,
            year: champion.year,
            pool: champion.pool,
            displayName: canonical,
            memberId,
            totalPoints: champion.totalPoints,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [champions.leagueId, champions.year, champions.pool, champions.displayName],
            set: { memberId, totalPoints: champion.totalPoints },
          });
      }

      outcomes.push({
        year: champion.year,
        pool: champion.pool,
        displayName: canonical,
        totalPoints: champion.totalPoints,
        linked: memberId !== null,
        action,
      });
    }
  };

  if (apply) await deps.db.transaction(run);
  else await run(deps.db);

  return outcomes;
}

/** Strip the rookie marker and stray spacing from a name we are storing verbatim. */
function tidy(raw: string): string {
  return raw.replaceAll(/®/gu, ' ').replaceAll(/\s+/gu, ' ').trim();
}
