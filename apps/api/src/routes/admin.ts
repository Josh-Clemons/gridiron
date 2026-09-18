import {
  correctPickRequestSchema,
  idSchema,
  pickPathSchema,
  seasonQuerySchema,
} from '@gridiron/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireMember, requireMembership, requireOwner } from '../data/leagues';
import { assertWeekInSeason, resolveSeason } from '../data/seasons';
import type { Deps } from '../deps';
import { correctPick, listCorrectionLog } from '../domain/corrections';
import type { AppEnv } from '../http/context';
import { requireAuth } from '../http/middleware';
import { readJson, readParams, readQuery } from '../http/validate';
import { leagueParamSchema } from './leagues';

const memberPickParamsSchema = leagueParamSchema
  .extend({ memberId: z.coerce.number().pipe(idSchema) })
  .extend(pickPathSchema.shape);

/**
 * The commissioner's tools — Phase 7.
 *
 * Every route here is two gates: `requireMembership` (a non-member is told the league
 * does not exist) then `requireOwner` (a plain member is turned away). The acting
 * member still comes from the session, never the request — the *target* member is the
 * one addressed by the path, which is the entire difference from `boardRoutes`.
 */
export function adminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use('/leagues/*', requireAuth(deps));

  /**
   * Correct one slot of any member's week.
   *
   * `teamId: null` clears the slot — how a pick that should score 0 is made explicit
   * rather than merely absent. A reason is required and becomes part of the log.
   */
  app.put('/leagues/:leagueId/admin/members/:memberId/picks/:week/:slot', async (c) => {
    const { leagueId, memberId, week, slot } = readParams(c, memberPickParamsSchema);
    const query = readQuery(c, seasonQuerySchema);
    const body = await readJson(c, correctPickRequestSchema);

    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const target = await requireMember(deps, leagueId, memberId);
    const season = await resolveSeason(deps, query.season);
    assertWeekInSeason(season, week);

    return c.json(
      await correctPick(
        deps,
        membership,
        target,
        season,
        week,
        slot,
        body.teamId,
        body.reason,
      ),
    );
  });

  /** The season's correction log, newest first. */
  app.get('/leagues/:leagueId/admin/corrections', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const query = readQuery(c, seasonQuerySchema);

    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const season = await resolveSeason(deps, query.season);

    return c.json(await listCorrectionLog(deps, membership.leagueId, season));
  });

  return app;
}
