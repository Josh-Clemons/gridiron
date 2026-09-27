import {
  pickPathSchema,
  putPickRequestSchema,
  seasonQuerySchema,
  type Standings,
  weekQuerySchema,
} from '@gridiron/contracts';
import { Hono } from 'hono';
import { listMembers, requireMembership } from '../data/leagues';
import { loadGames, loadLeaguePicks } from '../data/picks';
import { assertWeekInSeason, currentWeek, resolveSeason, type SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { buildBoard } from '../domain/board';
import { standingsCsv } from '../domain/csv';
import { buildUsage, clearPick, putPick } from '../domain/picks';
import {
  computeStandings,
  groupGamesByWeek,
  lockedPicksOf,
  rankMembers,
  scoreMembers,
} from '../domain/standings';
import type { AppEnv } from '../http/context';
import { requireAuth } from '../http/middleware';
import { readJson, readParams, readQuery } from '../http/validate';
import { leagueParamSchema } from './leagues';

const pickParamsSchema = leagueParamSchema.extend(pickPathSchema.shape);

/**
 * The pick page and the standings behind it.
 *
 * Everything here is scoped by `requireMembership`, which resolves the caller's own
 * `memberId` from their session. There is no code path that accepts a member id from
 * the client, which is what makes "user A cannot write user B's picks" structural
 * rather than a check someone can forget.
 */
export function boardRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use('/leagues/*', requireAuth(deps));

  app.get('/leagues/:leagueId/board', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, weekQuerySchema);
    const membership = await requireMembership(deps, leagueId, c.get('user').id);

    const season = await resolveSeason(deps, query.season);
    const week = await resolveWeek(deps, season, query.week);

    return c.json(await buildBoard(deps, membership, season, week));
  });

  app.put('/leagues/:leagueId/picks/:week/:slot', async (c) => {
    const { leagueId, week, slot } = readParams(c, pickParamsSchema);
    const query = readQuery(c, seasonQuerySchema);
    const body = await readJson(c, putPickRequestSchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);
    assertWeekInSeason(season, week);

    return c.json(await putPick(deps, membership, season, week, slot, body.teamId));
  });

  app.delete('/leagues/:leagueId/picks/:week/:slot', async (c) => {
    const { leagueId, week, slot } = readParams(c, pickParamsSchema);
    const query = readQuery(c, seasonQuerySchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);
    assertWeekInSeason(season, week);

    return c.json(await clearPick(deps, membership, season, week, slot));
  });

  app.get('/leagues/:leagueId/usage', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, seasonQuerySchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);

    return c.json(await buildUsage(deps, membership, season));
  });

  /**
   * The standings, with each member's locked picks for the week riding on their row.
   *
   * The privacy rule is relaxed exactly here and nowhere else: a pick whose game has
   * kicked off can no longer be changed, so it can no longer be copied. The board's
   * standings stay integers-only, so the pick page's payload does not grow.
   */
  app.get('/leagues/:leagueId/standings', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, weekQuerySchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);
    const week = await resolveWeek(deps, season, query.week);

    const [games, picks, members] = await Promise.all([
      loadGames(deps, season.id),
      loadLeaguePicks(deps, leagueId, season.id),
      listMembers(deps, leagueId),
    ]);

    const now = deps.now();
    const weekGames = groupGamesByWeek(games).get(week) ?? [];

    const response: Standings = {
      season: { id: season.id, year: season.year, weekCount: season.weekCount },
      week,
      rows: computeStandings({
        members,
        picks,
        games,
        weekCount: season.weekCount,
        week,
        selfMemberId: membership.memberId,
      }).map((row) => ({
        ...row,
        picks: lockedPicksOf(
          week,
          picks.filter((pick) => pick.memberId === row.memberId),
          weekGames,
          now,
        ),
      })),
    };
    return c.json(response);
  });

  /** The same standings as CSV, for a spreadsheet.
   *
   * Every member can download it — standings are visible to the whole league. Each row
   * carries the season total, each week's points, and each member's locked picks; a
   * pick whose game has not kicked off never appears, exactly as on the standings
   * page. Ranked by season points; the filename carries the season.
   */
  app.get('/leagues/:leagueId/standings.csv', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, seasonQuerySchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);

    const [games, picks, members] = await Promise.all([
      loadGames(deps, season.id),
      loadLeaguePicks(deps, leagueId, season.id),
      listMembers(deps, leagueId),
    ]);

    const rows = rankMembers(
      scoreMembers({
        members,
        picks,
        games,
        weekCount: season.weekCount,
        selfMemberId: membership.memberId,
      }),
    );

    return new Response(
      standingsCsv(rows, {
        picks,
        games,
        weekCount: season.weekCount,
        now: deps.now(),
      }),
      {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="standings-${String(season.year)}.csv"`,
        },
      },
    );
  });

  return app;
}

/** An explicit `?week=` must exist in the season; without one, use the live week. */
function resolveWeek(deps: Deps, season: SeasonRow, week?: number): Promise<number> {
  if (week === undefined) return currentWeek(deps, season);
  assertWeekInSeason(season, week);
  return Promise.resolve(week);
}
