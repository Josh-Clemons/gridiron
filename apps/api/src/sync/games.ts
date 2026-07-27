import { games, seasons } from '@gridiron/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { TeamCatalog } from '../data/teams';
import type { Deps } from '../deps';
import { type EspnClient, EspnError, type EspnGame } from './espn';

export interface WeekSyncResult {
  readonly week: number;
  readonly fetched: number;
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Rows we hold for this week that ESPN no longer lists. Reported, never deleted. */
  readonly orphaned: number;
}

export interface SeasonSyncResult {
  readonly year: number;
  readonly weeks: readonly WeekSyncResult[];
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly orphaned: number;
}

export interface SeasonRow {
  readonly id: number;
  readonly year: number;
  readonly weekCount: number;
}

export async function requireSeason(deps: Deps, year: number): Promise<SeasonRow> {
  const rows = await deps.db
    .select({ id: seasons.id, year: seasons.year, weekCount: seasons.weekCount })
    .from(seasons)
    .where(eq(seasons.year, year))
    .limit(1);

  const season = rows[0];
  if (season === undefined) {
    throw new Error(`no season ${String(year)} — add it to the seed and re-run pnpm db:seed`);
  }
  return season;
}

/**
 * Pull weeks from ESPN and make our `games` rows match.
 *
 * One operation covers both jobs in the plan: a schedule sync is this over every week,
 * a result sync is this over the live one. Kickoffs, statuses and winners all arrive in
 * the same payload, so splitting them into two code paths would only create a way for
 * them to disagree.
 *
 * Idempotent by construction — keyed on ESPN's event id, and rows that already match
 * are left untouched, so re-running is free and safe. Nothing incrementally mutates a
 * score: standings are derived from these rows on read, which means writing a result
 * *is* the rescore, and a corrected result fixes the table with no extra step.
 *
 * Weeks are fetched one at a time on purpose. This is somebody else's undocumented
 * endpoint and we are in no hurry.
 */
export async function syncWeeks(
  deps: Deps,
  client: EspnClient,
  year: number,
  weeks: readonly number[],
): Promise<SeasonSyncResult> {
  const season = await requireSeason(deps, year);
  const catalog = await deps.teams();
  const results: WeekSyncResult[] = [];

  for (const week of weeks) {
    // eslint-disable-next-line no-await-in-loop -- deliberately serial against a third-party API
    const fetched = await client.fetchWeek(year, week);
    // eslint-disable-next-line no-await-in-loop -- one transaction per week, in order
    const applied = await applyWeek(deps, catalog, season, week, fetched);
    results.push(applied);
  }

  return {
    year,
    weeks: results,
    inserted: sum(results, (result) => result.inserted),
    updated: sum(results, (result) => result.updated),
    unchanged: sum(results, (result) => result.unchanged),
    orphaned: sum(results, (result) => result.orphaned),
  };
}

/** Every week of a season — the weekly schedule sync, and how a past season is loaded. */
export async function syncSeason(
  deps: Deps,
  client: EspnClient,
  year: number,
): Promise<SeasonSyncResult> {
  const season = await requireSeason(deps, year);
  const weeks = Array.from({ length: season.weekCount }, (_, index) => index + 1);
  return syncWeeks(deps, client, year, weeks);
}

interface Resolved {
  readonly game: EspnGame;
  readonly homeTeamId: number;
  readonly awayTeamId: number;
  readonly winnerTeamId: number | null;
}

function applyWeek(
  deps: Deps,
  catalog: TeamCatalog,
  season: SeasonRow,
  week: number,
  fetched: readonly EspnGame[],
): Promise<WeekSyncResult> {
  const resolved = fetched.map((game) => resolve(catalog, game));
  const now = deps.now();

  return deps.db.transaction(async (tx) => {
    const externalIds = resolved.map((entry) => entry.game.externalId);
    const existing = await tx
      .select({
        id: games.id,
        externalId: games.externalId,
        week: games.week,
        homeTeamId: games.homeTeamId,
        awayTeamId: games.awayTeamId,
        kickoff: games.kickoff,
        status: games.status,
        winnerTeamId: games.winnerTeamId,
      })
      .from(games)
      .where(and(eq(games.seasonId, season.id), inArray(games.externalId, externalIds)));

    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const entry of resolved) {
      const current = byExternalId.get(entry.game.externalId);
      const values = {
        seasonId: season.id,
        week: entry.game.week,
        homeTeamId: entry.homeTeamId,
        awayTeamId: entry.awayTeamId,
        kickoff: entry.game.kickoff,
        status: entry.game.status,
        winnerTeamId: entry.winnerTeamId,
        externalId: entry.game.externalId,
      };

      if (current === undefined) {
        // eslint-disable-next-line no-await-in-loop -- ~16 rows, ordered inside one transaction
        await tx.insert(games).values({ ...values, updatedAt: now });
        inserted += 1;
        continue;
      }

      if (matches(current, values)) {
        unchanged += 1;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop -- ~16 rows, ordered inside one transaction
      await tx
        .update(games)
        .set({
          week: values.week,
          homeTeamId: values.homeTeamId,
          awayTeamId: values.awayTeamId,
          kickoff: values.kickoff,
          status: values.status,
          winnerTeamId: values.winnerTeamId,
          updatedAt: now,
        })
        .where(eq(games.id, current.id));
      updated += 1;
    }

    // A game we hold for this week that ESPN didn't return — a postponement, a
    // relocation, or an id change. Deleting it would silently void everyone's picks
    // for that game, so it's counted and reported instead.
    const held = await tx
      .select({ externalId: games.externalId })
      .from(games)
      .where(and(eq(games.seasonId, season.id), eq(games.week, week)));
    const seen = new Set(externalIds);
    const orphaned = held.filter(
      (row) => row.externalId === null || !seen.has(row.externalId),
    ).length;

    return { week, fetched: fetched.length, inserted, updated, unchanged, orphaned };
  });
}

function resolve(catalog: TeamCatalog, game: EspnGame): Resolved {
  const home = catalog.resolve(game.homeTeam);
  const away = catalog.resolve(game.awayTeam);
  if (home === undefined || away === undefined) {
    // Never guess at a team. An unrecognised code means a relocation or rename, and
    // the fix is one deliberate row in `team_aliases`, not a fuzzy match.
    throw new EspnError(
      `unknown team code in event ${game.externalId}: ${home === undefined ? game.homeTeam : game.awayTeam}`,
    );
  }

  let winnerTeamId: number | null = null;
  if (game.winner !== null) {
    const winner = catalog.resolve(game.winner);
    if (winner === undefined) {
      throw new EspnError(`unknown winning team code ${game.winner} in event ${game.externalId}`);
    }
    winnerTeamId = winner.id;
  }

  return { game, homeTeamId: home.id, awayTeamId: away.id, winnerTeamId };
}

interface Comparable {
  readonly week: number;
  readonly homeTeamId: number;
  readonly awayTeamId: number;
  readonly kickoff: Date;
  readonly status: 'scheduled' | 'final';
  readonly winnerTeamId: number | null;
}

function matches(current: Comparable, next: Comparable): boolean {
  return (
    current.week === next.week &&
    current.homeTeamId === next.homeTeamId &&
    current.awayTeamId === next.awayTeamId &&
    current.kickoff.getTime() === next.kickoff.getTime() &&
    current.status === next.status &&
    current.winnerTeamId === next.winnerTeamId
  );
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
