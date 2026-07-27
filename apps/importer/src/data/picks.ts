import type { Game, Pick, Slot } from '@gridiron/rules';
import { games, leagueMembers, picks } from '@gridiron/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx, Deps } from './deps';
import type { TeamCatalog } from './teams';

/** A stored pick, with the team already translated to its canonical code. */
export interface StoredPick extends Pick {
  readonly memberId: number;
  readonly source: 'app' | 'import';
}

/**
 * A season's schedule, in the shape `@gridiron/rules` expects.
 *
 * Team ids become codes through the in-memory catalog rather than three joins back to
 * `teams`. That is not only cheaper — a partial select combined with a left join infers
 * as `never` under this repo's TypeScript, so the joins would not compile anyway.
 */
export async function loadGames(deps: Deps, seasonId: number): Promise<Game[]> {
  const catalog = await deps.teams();
  const rows = await deps.db
    .select({
      id: games.id,
      week: games.week,
      homeTeamId: games.homeTeamId,
      awayTeamId: games.awayTeamId,
      kickoff: games.kickoff,
      status: games.status,
      winnerTeamId: games.winnerTeamId,
    })
    .from(games)
    .where(eq(games.seasonId, seasonId))
    .orderBy(games.kickoff, games.id);

  return rows.map((row) => ({
    id: String(row.id),
    week: row.week,
    homeTeam: catalog.codeFor(row.homeTeamId),
    awayTeam: catalog.codeFor(row.awayTeamId),
    kickoff: row.kickoff,
    status: row.status,
    winner: row.winnerTeamId === null ? null : catalog.codeFor(row.winnerTeamId),
  }));
}

/** Every live pick in a league for a season, across all members. */
export async function loadLeaguePicks(
  db: DbOrTx,
  catalog: TeamCatalog,
  leagueId: number,
  seasonId: number,
): Promise<StoredPick[]> {
  const rows = await db
    .select({
      memberId: picks.leagueMemberId,
      week: picks.week,
      slot: picks.slot,
      teamId: picks.teamId,
      source: picks.source,
    })
    .from(picks)
    .innerJoin(leagueMembers, eq(leagueMembers.id, picks.leagueMemberId))
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(picks.seasonId, seasonId),
        isNull(picks.deletedAt),
        isNull(leagueMembers.removedAt),
      ),
    );

  return rows.map((row) => ({
    memberId: row.memberId,
    week: row.week,
    slot: row.slot,
    teamId: catalog.codeFor(row.teamId),
    source: row.source,
  }));
}

export interface UpsertInput {
  readonly memberId: number;
  readonly seasonId: number;
  readonly week: number;
  readonly slot: Slot;
  readonly teamCode: string;
}

/**
 * Write one slot, stamped as imported.
 *
 * Keyed on `(member, season, week, slot)` — the same natural key the unique index uses
 * — so re-running the same workbook updates in place and never duplicates. Returns
 * whether anything actually changed, which is what lets the report distinguish "3 new
 * picks" from "the file you already loaded".
 */
export async function upsertImportedPick(
  db: DbOrTx,
  catalog: TeamCatalog,
  input: UpsertInput,
  now: Date,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const team = catalog.resolve(input.teamCode);
  if (team === undefined) throw new Error(`unknown team ${input.teamCode}`);

  const existing = await db
    .select({ id: picks.id, teamId: picks.teamId, source: picks.source })
    .from(picks)
    .where(
      and(
        eq(picks.leagueMemberId, input.memberId),
        eq(picks.seasonId, input.seasonId),
        eq(picks.week, input.week),
        eq(picks.slot, input.slot),
        isNull(picks.deletedAt),
      ),
    )
    .limit(1);

  const current = existing[0];
  if (current !== undefined && current.teamId === team.id && current.source === 'import') {
    // Byte-identical to what is already stored. Skipping the write keeps `updated_at`
    // stable, so "apply twice leaves the database identical" is true of every column
    // rather than only of the ones anyone thought to compare.
    return 'unchanged';
  }

  await db
    .insert(picks)
    .values({
      leagueMemberId: input.memberId,
      seasonId: input.seasonId,
      week: input.week,
      slot: input.slot,
      teamId: team.id,
      source: 'import',
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [picks.leagueMemberId, picks.seasonId, picks.week, picks.slot],
      targetWhere: isNull(picks.deletedAt),
      set: { teamId: team.id, source: 'import', updatedAt: now },
    });

  return current === undefined ? 'inserted' : 'updated';
}

/**
 * Clear a slot whose pick has vanished from the workbook.
 *
 * Soft-deleted: the row survives for provenance, while the partial unique indexes stop
 * seeing it, so the slot and the team both become available again straight away.
 */
export async function softDeletePick(
  db: DbOrTx,
  memberId: number,
  seasonId: number,
  week: number,
  slot: Slot,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(picks)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(picks.leagueMemberId, memberId),
        eq(picks.seasonId, seasonId),
        eq(picks.week, week),
        eq(picks.slot, slot),
        isNull(picks.deletedAt),
      ),
    )
    .returning({ id: picks.id });

  return rows.length > 0;
}
