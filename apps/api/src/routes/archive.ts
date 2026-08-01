import {
  type Champions,
  type SeasonHistory,
  type Seasons,
  seasonQuerySchema,
} from '@gridiron/contracts';
import { Hono } from 'hono';
import { listChampions } from '../data/champions';
import { requireMembership } from '../data/leagues';
import { listSeasons, resolveSeason } from '../data/seasons';
import type { Deps } from '../deps';
import { buildChampions } from '../domain/champions';
import { buildSeasonHistory } from '../domain/history';
import type { AppEnv } from '../http/context';
import { requireAuth } from '../http/middleware';
import { readParams, readQuery } from '../http/validate';
import { leagueParamSchema } from './leagues';

/**
 * The history side of a league: which seasons exist, a finished season week by week,
 * and the honours board.
 *
 * Nothing here has a write path. The champions list is written by the importer from
 * the commissioner's workbook, and the grid is derived from picks and results every
 * time it is asked for — so a corrected result or a fixed pick shows up in the archive
 * without anything having to be rebuilt.
 */
export function archiveRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use('/leagues/*', requireAuth(deps));

  app.get('/leagues/:leagueId/seasons', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    await requireMembership(deps, leagueId, c.get('user').id);

    const rows = await listSeasons(deps, leagueId);
    const response: Seasons = {
      seasons: rows.map((row) => ({
        id: row.id,
        year: row.year,
        weekCount: row.weekCount,
        hasGames: row.hasGames,
        hasPicks: row.hasPicks,
      })),
    };
    return c.json(response);
  });

  app.get('/leagues/:leagueId/history', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, seasonQuerySchema);

    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const season = await resolveSeason(deps, query.season);

    const history: SeasonHistory = await buildSeasonHistory(deps, membership, season);
    return c.json(history);
  });

  app.get('/leagues/:leagueId/champions', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    await requireMembership(deps, leagueId, c.get('user').id);

    const response: Champions = buildChampions(await listChampions(deps, leagueId));
    return c.json(response);
  });

  return app;
}
