import type { League, RegenerateInviteResponse } from '@gridiron/contracts';
import { countMembers } from '../data/leagues';
import type { Membership } from '../data/leagues';
import {
  regenerateInviteCode,
  renameLeagueRow,
  setLeagueArchived,
  type LeagueAdminRow,
} from '../data/league-admin';
import type { Deps } from '../deps';
import { forbidden } from '../http/errors';

function assertOwner(actor: Membership): void {
  if (actor.role !== 'owner') throw forbidden('only the owner can do that');
}

function toWireLeague(row: LeagueAdminRow, actor: Membership, memberCount: number): League {
  return {
    id: row.id,
    name: row.name,
    inviteCode: row.inviteCode,
    memberCount,
    memberId: actor.memberId,
    role: actor.role,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function renameLeague(deps: Deps, actor: Membership, name: string): Promise<League> {
  assertOwner(actor);
  const row = await renameLeagueRow(deps, actor.leagueId, name);
  return toWireLeague(row, actor, await countMembers(deps, actor.leagueId));
}

export async function regenerateLeagueInvite(
  deps: Deps,
  actor: Membership,
): Promise<RegenerateInviteResponse> {
  assertOwner(actor);
  const inviteCode = await regenerateInviteCode(deps, actor.leagueId);
  return { inviteCode };
}

export async function archiveLeague(deps: Deps, actor: Membership): Promise<League> {
  assertOwner(actor);
  const row = await setLeagueArchived(deps, actor.leagueId, true, deps.now());
  return toWireLeague(row, actor, await countMembers(deps, actor.leagueId));
}

export async function unarchiveLeague(deps: Deps, actor: Membership): Promise<League> {
  assertOwner(actor);
  const row = await setLeagueArchived(deps, actor.leagueId, false, deps.now());
  return toWireLeague(row, actor, await countMembers(deps, actor.leagueId));
}
