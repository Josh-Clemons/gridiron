import type { Game, Pick, Slot } from '@gridiron/rules';
import { games, leagueMembers, picks } from '@gridiron/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { Deps } from '../deps';
import type { TeamCatalog } from './teams';

/** A stored pick, with the team already translated to its canonical code. */
export interface PickRow extends Pick {
  readonly memberId: number;
  readonly source: 'app' | 'import';
  readonly updatedAt: Date;
}

/**
 * A season's schedule in the shape `@gridiron/rules` expects.
 *
 * Team ids become codes through the in-memory catalog rather than three joins back to
 * `teams` — the schedule is ~270 rows and the catalog is 32, so the translation is
 * free and the query stays a single-table scan on `games(season_id, week)`.
 */
export async function loadGames(deps: Deps, seasonId: number, week?: number): Promise<Game[]> {
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
    .where(
      week === undefined
        ? eq(games.seasonId, seasonId)
        : and(eq(games.seasonId, seasonId), eq(games.week, week)),
    )
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

/**
 * Every pick a member holds this season.
 *
 * Validation needs the whole season, not just the week being edited: the once-per-slot
 * rule is a season-long constraint, so a week-16 write has to see week 3.
 */
export async function loadMemberPicks(
  deps: Deps,
  memberId: number,
  seasonId: number,
): Promise<PickRow[]> {
  const catalog = await deps.teams();
  const rows = await deps.db
    .select({
      week: picks.week,
      slot: picks.slot,
      teamId: picks.teamId,
      source: picks.source,
      updatedAt: picks.updatedAt,
    })
    .from(picks)
    .where(
      and(
        eq(picks.leagueMemberId, memberId),
        eq(picks.seasonId, seasonId),
        isNull(picks.deletedAt),
      ),
    )
    .orderBy(picks.week);

  return rows.map((row) => ({
    memberId,
    week: row.week,
    slot: row.slot,
    teamId: catalog.codeFor(row.teamId),
    source: row.source,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Every pick in a league for a season, for standings.
 *
 * At 72 members and 18 weeks this is ~3,900 narrow rows — small enough to score in
 * one pass with the same engine the rest of the app uses, which matters more than the
 * marginal speed of an SQL aggregate. Scoring lives in exactly one place, and it is a
 * pure function that can be replayed at any time. If this ever gets slow, cache the
 * result; don't reimplement the rules in SQL.
 */
export async function loadLeaguePicks(
  deps: Deps,
  leagueId: number,
  seasonId: number,
): Promise<PickRow[]> {
  const catalog = await deps.teams();
  const rows = await deps.db
    .select({
      memberId: picks.leagueMemberId,
      week: picks.week,
      slot: picks.slot,
      teamId: picks.teamId,
      source: picks.source,
      updatedAt: picks.updatedAt,
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
    updatedAt: row.updatedAt,
  }));
}

export interface UpsertPickInput {
  readonly memberId: number;
  readonly seasonId: number;
  readonly week: number;
  readonly slot: Slot;
  readonly teamCode: string;
  readonly source: 'app' | 'import';
}

/**
 * Write one slot.
 *
 * Keyed on `(member, season, week, slot)` — the same natural key the unique index
 * uses — so a repeated write is an update, never a duplicate row. The caller has
 * already run `validatePick`; the partial unique index on `(member, season, slot,
 * team)` is the backstop if it ever forgets.
 */
export async function upsertPick(
  deps: Deps,
  catalog: TeamCatalog,
  input: UpsertPickInput,
): Promise<PickRow> {
  const team = catalog.resolve(input.teamCode);
  if (team === undefined) throw new Error(`unknown team ${input.teamCode}`);

  const now = deps.now();
  const rows = await deps.db
    .insert(picks)
    .values({
      leagueMemberId: input.memberId,
      seasonId: input.seasonId,
      week: input.week,
      slot: input.slot,
      teamId: team.id,
      source: input.source,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [picks.leagueMemberId, picks.seasonId, picks.week, picks.slot],
      targetWhere: isNull(picks.deletedAt),
      set: { teamId: team.id, source: input.source, updatedAt: now },
    })
    .returning({ updatedAt: picks.updatedAt, source: picks.source });

  const row = rows[0];
  if (row === undefined) throw new Error('pick upsert returned nothing');
  return {
    memberId: input.memberId,
    week: input.week,
    slot: input.slot,
    teamId: team.code,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

/**
 * Clear one slot.
 *
 * Soft-deleted: the row stays for provenance and for the importer's "this pick
 * vanished from the sheet" reconciliation, while the partial unique indexes ignore it
 * so the slot and the team both become available again immediately.
 */
export async function softDeletePick(
  deps: Deps,
  memberId: number,
  seasonId: number,
  week: number,
  slot: Slot,
): Promise<boolean> {
  const now = deps.now();
  const rows = await deps.db
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
