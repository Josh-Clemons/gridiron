import type { TeamsResponse } from '@gridiron/contracts';
import { Hono } from 'hono';
import type { Deps } from '../deps';
import type { AppEnv } from '../http/context';

/**
 * The 32 teams and their names.
 *
 * Seed data, identical for everyone and not worth a session check, so this is the one
 * league-independent read in the app. The client fetches it once and caches it for the
 * life of the tab; without it the web app would have to keep its own copy of the team
 * table, which is exactly the kind of second source of truth the alias table exists to
 * avoid.
 */
export function teamRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get('/teams', async (c) => {
    const catalog = await deps.teams();
    const response: TeamsResponse = {
      teams: catalog.list().map((team) => ({
        code: team.code,
        name: team.name,
        shortName: team.shortName,
      })),
    };
    return c.json(response);
  });

  return app;
}
