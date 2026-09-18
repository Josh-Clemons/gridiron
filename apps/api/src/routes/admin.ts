import {
  correctPickRequestSchema,
  idSchema,
  renameMemberRequestSchema,
  pickPathSchema,
  seasonQuerySchema,
  seasonYearSchema,
  updateLeagueSettingsRequestSchema,
} from '@gridiron/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireMember, requireMembership, requireOwner } from '../data/leagues';
import { requireManagedMember } from '../data/members';
import { assertWeekInSeason, resolveSeason } from '../data/seasons';
import type { Deps } from '../deps';
import { correctPick, listCorrectionLog } from '../domain/corrections';
import {
  archiveLeague,
  regenerateLeagueInvite,
  renameLeague,
  unarchiveLeague,
} from '../domain/league-admin';
import {
  applyWorkbook,
  downloadWorkbook,
  listWorkbookUploads,
  uploadWorkbook,
} from '../domain/workbooks';
import {
  listMemberManagement,
  removeMember,
  renameMember,
  restoreMember,
  transferMemberOwnership,
} from '../domain/members';
import type { AppEnv } from '../http/context';
import { badRequest } from '../http/errors';
import { requireAuth } from '../http/middleware';
import { readJson, readParams, readQuery, readUploadedFile } from '../http/validate';
import { leagueParamSchema } from './leagues';

const memberPickParamsSchema = leagueParamSchema
  .extend({ memberId: z.coerce.number().pipe(idSchema) })
  .extend(pickPathSchema.shape);
const memberParamsSchema = leagueParamSchema.extend({ memberId: z.coerce.number().pipe(idSchema) });
const workbookParamsSchema = leagueParamSchema.extend({
  workbookId: z.coerce.number().pipe(idSchema),
});

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

  /** Rename the league. */
  app.patch('/leagues/:leagueId/admin/settings', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const body = await readJson(c, updateLeagueSettingsRequestSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await renameLeague(deps, membership, body.name));
  });

  /** Regenerate the invite code; the old one stops working immediately. */
  app.post('/leagues/:leagueId/admin/invite', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await regenerateLeagueInvite(deps, membership));
  });

  /** Archive the league — picks freeze. */
  app.post('/leagues/:leagueId/admin/archive', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await archiveLeague(deps, membership));
  });

  /** Unarchive — roll the league into the next season. */
  app.post('/leagues/:leagueId/admin/unarchive', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await unarchiveLeague(deps, membership));
  });

  /** Upload a workbook; it is stored and validated, but nothing is imported yet. */
  app.post('/leagues/:leagueId/admin/workbooks', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const form = await c.req.formData();
    const uploaded = await readUploadedFile(form.get('file'));
    const season = seasonYearSchema.safeParse(Number(form.get('season')));
    if (!season.success) throw badRequest('season is required');
    return c.json(
      await uploadWorkbook(deps, membership, {
        originalName: uploaded.name,
        bytes: uploaded.bytes,
        seasonYear: season.data,
      }),
    );
  });

  /** Every uploaded workbook, newest first. */
  app.get('/leagues/:leagueId/admin/workbooks', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await listWorkbookUploads(deps, membership));
  });

  /** The confirmed second half: apply a validated workbook. */
  app.post('/leagues/:leagueId/admin/workbooks/:workbookId/apply', async (c) => {
    const { leagueId, workbookId } = readParams(c, workbookParamsSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await applyWorkbook(deps, membership, workbookId));
  });

  /** Stream the stored workbook back, for the operator or a re-check. */
  app.get('/leagues/:leagueId/admin/workbooks/:workbookId/download', async (c) => {
    const { leagueId, workbookId } = readParams(c, workbookParamsSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const { name, bytes } = await downloadWorkbook(deps, membership, workbookId);
    const safeName = name.replace(/["\r\n\\]/g, '_');
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${safeName}"`,
      },
    });
  });

  /** The complete roster, including removed slots available for restoration. */
  app.get('/leagues/:leagueId/admin/members', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    return c.json(await listMemberManagement(deps, membership));
  });

  /** Rename a league-local roster label. */
  app.patch('/leagues/:leagueId/admin/members/:memberId', async (c) => {
    const { leagueId, memberId } = readParams(c, memberParamsSchema);
    const body = await readJson(c, renameMemberRequestSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const target = await requireManagedMember(deps, leagueId, memberId);
    return c.json(await renameMember(deps, membership, target, body.displayName));
  });

  /** Remove a member without deleting their roster slot or picks. */
  app.delete('/leagues/:leagueId/admin/members/:memberId', async (c) => {
    const { leagueId, memberId } = readParams(c, memberParamsSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const target = await requireManagedMember(deps, leagueId, memberId);
    return c.json(await removeMember(deps, membership, target));
  });

  /** Restore a previously removed roster slot as an unclaimed member. */
  app.post('/leagues/:leagueId/admin/members/:memberId/restore', async (c) => {
    const { leagueId, memberId } = readParams(c, memberParamsSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const target = await requireManagedMember(deps, leagueId, memberId);
    return c.json(await restoreMember(deps, membership, target));
  });

  /** Transfer ownership to another claimed active member. */
  app.post('/leagues/:leagueId/admin/members/:memberId/transfer-ownership', async (c) => {
    const { leagueId, memberId } = readParams(c, memberParamsSchema);
    const membership = requireOwner(await requireMembership(deps, leagueId, c.get('user').id));
    const target = await requireManagedMember(deps, leagueId, memberId);
    return c.json(await transferMemberOwnership(deps, membership, target));
  });

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
      await correctPick(deps, membership, target, season, week, slot, body.teamId, body.reason),
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
