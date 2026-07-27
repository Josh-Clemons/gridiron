import {
  createLeagueRequestSchema,
  idSchema,
  inviteCodeSchema,
  type JoinPreview,
  joinLeagueRequestSchema,
  type League,
  type LeagueMember,
} from '@gridiron/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  countMembers,
  createLeague,
  joinLeague,
  leaveLeague,
  listMembers,
  listMemberships,
  type Membership,
  previewJoin,
  requireMembership,
} from '../data/leagues';
import type { Deps } from '../deps';
import type { AppEnv } from '../http/context';
import { requireAuth } from '../http/middleware';
import { readJson, readParams, readQuery } from '../http/validate';

export const leagueParamSchema = z.object({
  leagueId: z.coerce.number().pipe(idSchema),
});

const previewQuerySchema = z.object({ code: inviteCodeSchema });

function toLeague(membership: Membership, memberCount: number): League {
  return {
    id: membership.leagueId,
    name: membership.leagueName,
    inviteCode: membership.inviteCode,
    memberCount,
    memberId: membership.memberId,
    role: membership.role,
    createdAt: membership.createdAt.toISOString(),
    archivedAt: membership.archivedAt?.toISOString() ?? null,
  };
}

export function leagueRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use('/leagues/*', requireAuth(deps));

  app.post('/leagues', async (c) => {
    const user = c.get('user');
    const body = await readJson(c, createLeagueRequestSchema);
    const membership = await createLeague(deps, user.id, body.name, user.displayName);
    return c.json(toLeague(membership, 1), 201);
  });

  app.get('/leagues', async (c) => {
    const memberships = await listMemberships(deps, c.get('user').id);
    const leagues = await Promise.all(
      memberships.map(async (membership) =>
        toLeague(membership, await countMembers(deps, membership.leagueId)),
      ),
    );
    return c.json({ leagues });
  });

  /**
   * Look at a league before joining it.
   *
   * Registered before `/leagues/:leagueId` so the literal path wins the match.
   */
  app.get('/leagues/preview', async (c) => {
    const query = readQuery(c, previewQuerySchema);
    const preview = await previewJoin(deps, query.code, c.get('user').id);
    const response: JoinPreview = {
      league: {
        id: preview.leagueId,
        name: preview.leagueName,
        memberCount: preview.memberCount,
      },
      unclaimedMembers: preview.unclaimed.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        pickCount: member.pickCount,
      })),
      alreadyMember: preview.alreadyMember,
    };
    return c.json(response);
  });

  /**
   * Join by invite code, optionally claiming an imported roster slot.
   *
   * This is how the spreadsheet league migrates one player at a time: the importer
   * has already loaded their picks under a placeholder, and claiming it hands them
   * the history rather than starting them at zero.
   */
  app.post('/leagues/join', async (c) => {
    const user = c.get('user');
    const body = await readJson(c, joinLeagueRequestSchema);
    const membership = await joinLeague(deps, user.id, user.displayName, {
      inviteCode: body.inviteCode,
      ...(body.claimMemberId === undefined ? {} : { claimMemberId: body.claimMemberId }),
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    });
    const count = await countMembers(deps, membership.leagueId);
    return c.json(toLeague(membership, count));
  });

  app.get('/leagues/:leagueId', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    return c.json(toLeague(membership, await countMembers(deps, leagueId)));
  });

  app.get('/leagues/:leagueId/members', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    const rows = await listMembers(deps, leagueId);

    const members: LeagueMember[] = rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      claimed: row.userId !== null,
      isSelf: row.id === membership.memberId,
      joinedAt: row.joinedAt.toISOString(),
    }));
    return c.json({ members });
  });

  app.post('/leagues/:leagueId/leave', async (c) => {
    const { leagueId } = readParams(c, leagueParamSchema);
    const membership = await requireMembership(deps, leagueId, c.get('user').id);
    await leaveLeague(deps, membership);
    return c.body(null, 204);
  });

  return app;
}
