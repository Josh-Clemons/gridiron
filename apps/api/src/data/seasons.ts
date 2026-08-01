import { games, leagueMembers, picks, seasons } from '@gridiron/schema';
import { and, desc, eq, inArray, isNull, min, ne } from 'drizzle-orm';
import type { Deps } from '../deps';
import { notFound } from '../http/errors';

export interface SeasonRow {
  readonly id: number;
  readonly year: number;
  readonly weekCount: number;
}

export interface SeasonSummaryRow extends SeasonRow {
  readonly hasGames: boolean;
  readonly hasPicks: boolean;
}

/**
 * The seasons worth offering this league, newest first.
 *
 * Seeded years with neither a schedule nor a pick are dropped: `seasons` is reference
 * data seeded ahead of time, and a season picker that lists a year with nothing behind
 * it just hands out dead links.
 *
 * Three narrow queries rather than one with correlated subqueries. Each answers a
 * question about a handful of distinct season ids, and combining them in JS keeps the
 * result readable and the SQL free of the partial-select joins that TypeScript 7 and
 * Drizzle disagree about.
 */
export async function listSeasons(deps: Deps, leagueId: number): Promise<SeasonSummaryRow[]> {
  const memberIds = deps.db
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));

  const [all, scheduled, played] = await Promise.all([
    deps.db
      .select({ id: seasons.id, year: seasons.year, weekCount: seasons.weekCount })
      .from(seasons)
      .orderBy(desc(seasons.year)),
    deps.db.selectDistinct({ seasonId: games.seasonId }).from(games),
    deps.db
      .selectDistinct({ seasonId: picks.seasonId })
      .from(picks)
      .where(and(inArray(picks.leagueMemberId, memberIds), isNull(picks.deletedAt))),
  ]);

  const hasGames = new Set(scheduled.map((row) => row.seasonId));
  const hasPicks = new Set(played.map((row) => row.seasonId));

  return all
    .filter((season) => hasGames.has(season.id) || hasPicks.has(season.id))
    .map((season) => ({
      id: season.id,
      year: season.year,
      weekCount: season.weekCount,
      hasGames: hasGames.has(season.id),
      hasPicks: hasPicks.has(season.id),
    }));
}

/**
 * Resolve the season a request is about.
 *
 * Every league-scoped route takes an optional `?season=YYYY` and falls back to the
 * newest season on record. Nothing in the schema pins a league to a season, which
 * keeps history and the current year on exactly the same code path — the Phase 6
 * archive views are the same endpoints with the parameter supplied.
 */
export async function resolveSeason(deps: Deps, year?: number): Promise<SeasonRow> {
  const rows = await deps.db
    .select({ id: seasons.id, year: seasons.year, weekCount: seasons.weekCount })
    .from(seasons)
    .where(year === undefined ? undefined : eq(seasons.year, year))
    .orderBy(desc(seasons.year))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw notFound(year === undefined ? 'no seasons exist' : `no season ${String(year)}`);
  }
  return row;
}

/**
 * The week the app should open on: the earliest one that isn't fully played.
 *
 * Derived from game status rather than the calendar, so it behaves during the
 * offseason (before any results exist it stays at week 1) and after the finale
 * (it settles on the last week rather than running off the end).
 */
export async function currentWeek(deps: Deps, season: SeasonRow): Promise<number> {
  const rows = await deps.db
    .select({ week: min(games.week) })
    .from(games)
    .where(and(eq(games.seasonId, season.id), ne(games.status, 'final')));

  const week = rows[0]?.week;
  if (week !== null && week !== undefined) return Math.min(week, season.weekCount);

  const played = await deps.db
    .select({ week: min(games.week) })
    .from(games)
    .where(eq(games.seasonId, season.id));

  // No schedule loaded at all: week 1. Otherwise every game is final, so the season
  // is over and the last week is the interesting one.
  return played[0]?.week === null || played[0]?.week === undefined ? 1 : season.weekCount;
}

/** Weeks are 1..`weekCount`; anything else is a client bug, not an empty board. */
export function assertWeekInSeason(season: SeasonRow, week: number): void {
  if (week < 1 || week > season.weekCount) {
    throw notFound(`season ${String(season.year)} has no week ${String(week)}`);
  }
}
