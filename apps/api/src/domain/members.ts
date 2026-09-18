import type { AdminMember, AdminMemberResponse, AdminMembersResponse } from '@gridiron/contracts';
import type { Membership } from '../data/leagues';
import {
  listManagedMembers,
  removeManagedMember,
  renameManagedMember,
  restoreManagedMember,
  transferOwnership,
  type ManagedMemberRow,
} from '../data/members';
import type { Deps } from '../deps';
import { conflict, forbidden } from '../http/errors';

function assertOwner(actor: Membership): void {
  if (actor.role !== 'owner') throw forbidden('only the owner can do that');
  if (actor.archivedAt !== null) throw forbidden('this league is archived');
}

function toWireMember(row: ManagedMemberRow, selfMemberId: number): AdminMember {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    claimed: row.userId !== null,
    isSelf: row.id === selfMemberId,
    joinedAt: row.joinedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

export async function listMemberManagement(
  deps: Deps,
  actor: Membership,
): Promise<AdminMembersResponse> {
  assertOwner(actor);
  const rows = await listManagedMembers(deps, actor.leagueId);
  return { members: rows.map((row) => toWireMember(row, actor.memberId)) };
}

export async function renameMember(
  deps: Deps,
  actor: Membership,
  target: ManagedMemberRow,
  displayName: string,
): Promise<AdminMemberResponse> {
  assertOwner(actor);
  const row = await renameManagedMember(deps, actor.leagueId, target.id, displayName);
  return { member: toWireMember(row, actor.memberId) };
}

export async function removeMember(
  deps: Deps,
  actor: Membership,
  target: ManagedMemberRow,
): Promise<AdminMemberResponse> {
  assertOwner(actor);
  if (target.id === actor.memberId) throw forbidden('transfer ownership before leaving');
  if (target.role === 'owner') throw forbidden('an owner cannot be removed');
  if (target.removedAt !== null) throw conflict('member is already removed');
  const row = await removeManagedMember(deps, actor.leagueId, target.id, deps.now());
  return { member: toWireMember(row, actor.memberId) };
}

export async function restoreMember(
  deps: Deps,
  actor: Membership,
  target: ManagedMemberRow,
): Promise<AdminMemberResponse> {
  assertOwner(actor);
  if (target.role === 'owner') throw forbidden('an owner cannot be restored this way');
  if (target.removedAt === null) throw conflict('member is already active');
  const row = await restoreManagedMember(deps, actor.leagueId, target.id);
  return { member: toWireMember(row, actor.memberId) };
}

export async function transferMemberOwnership(
  deps: Deps,
  actor: Membership,
  target: ManagedMemberRow,
): Promise<AdminMemberResponse> {
  assertOwner(actor);
  if (target.id === actor.memberId) throw conflict('you already own this league');
  if (target.role === 'owner') throw conflict('member already owns this league');
  if (target.userId === null) throw conflict('an unclaimed member cannot own a league');
  if (target.removedAt !== null) throw conflict('a removed member cannot own a league');
  const row = await transferOwnership(deps, actor.leagueId, actor.memberId, target.id);
  return { member: toWireMember(row, actor.memberId) };
}
