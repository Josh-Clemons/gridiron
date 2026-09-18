import { leagueMembers } from '@gridiron/schema';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { conflict, notFound } from '../http/errors';

export interface ManagedMemberRow {
  readonly id: number;
  readonly displayName: string;
  readonly role: 'owner' | 'member';
  readonly userId: number | null;
  readonly joinedAt: Date;
  readonly removedAt: Date | null;
}

const managedMemberSelection = {
  id: leagueMembers.id,
  displayName: leagueMembers.displayName,
  role: leagueMembers.role,
  userId: leagueMembers.userId,
  joinedAt: leagueMembers.joinedAt,
  removedAt: leagueMembers.removedAt,
};

/** A specific member of a league, including removed roster slots. */
export async function requireManagedMember(
  deps: Deps,
  leagueId: number,
  memberId: number,
): Promise<ManagedMemberRow> {
  const rows = await deps.db
    .select(managedMemberSelection)
    .from(leagueMembers)
    .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.leagueId, leagueId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw notFound('member not found');
  return row;
}

/** All roster slots for the owner, including removed slots that may be restored. */
export function listManagedMembers(deps: Deps, leagueId: number): Promise<ManagedMemberRow[]> {
  return deps.db
    .select(managedMemberSelection)
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId))
    .orderBy(sql`lower(${leagueMembers.displayName})`, leagueMembers.id);
}

export async function renameManagedMember(
  deps: Deps,
  leagueId: number,
  memberId: number,
  displayName: string,
): Promise<ManagedMemberRow> {
  const rows = await deps.db
    .update(leagueMembers)
    .set({ displayName })
    .where(and(eq(leagueMembers.id, memberId), eq(leagueMembers.leagueId, leagueId)))
    .returning(managedMemberSelection);
  const row = rows[0];
  if (row === undefined) throw notFound('member not found');
  return row;
}

export async function removeManagedMember(
  deps: Deps,
  leagueId: number,
  memberId: number,
  now: Date,
): Promise<ManagedMemberRow> {
  const rows = await deps.db
    .update(leagueMembers)
    .set({ removedAt: now, userId: null })
    .where(
      and(
        eq(leagueMembers.id, memberId),
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.role, 'member'),
        isNull(leagueMembers.removedAt),
      ),
    )
    .returning(managedMemberSelection);
  const row = rows[0];
  if (row === undefined) throw conflict('member cannot be removed');
  return row;
}

export async function restoreManagedMember(
  deps: Deps,
  leagueId: number,
  memberId: number,
): Promise<ManagedMemberRow> {
  const rows = await deps.db
    .update(leagueMembers)
    .set({ removedAt: null, userId: null })
    .where(
      and(
        eq(leagueMembers.id, memberId),
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.role, 'member'),
        sql`${leagueMembers.removedAt} is not null`,
      ),
    )
    .returning(managedMemberSelection);
  const row = rows[0];
  if (row === undefined) throw conflict('member cannot be restored');
  return row;
}

/** Transfer ownership while serialising on the current owner's row. */
export function transferOwnership(
  deps: Deps,
  leagueId: number,
  actorMemberId: number,
  targetMemberId: number,
): Promise<ManagedMemberRow> {
  return deps.db.transaction(async (tx) => {
    const demoted = await tx
      .update(leagueMembers)
      .set({ role: 'member' })
      .where(
        and(
          eq(leagueMembers.id, actorMemberId),
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.role, 'owner'),
          isNull(leagueMembers.removedAt),
        ),
      )
      .returning({ id: leagueMembers.id });
    if (demoted.length === 0) throw conflict('ownership has changed; try again');

    const promoted = await tx
      .update(leagueMembers)
      .set({ role: 'owner' })
      .where(
        and(
          eq(leagueMembers.id, targetMemberId),
          eq(leagueMembers.leagueId, leagueId),
          eq(leagueMembers.role, 'member'),
          isNotNull(leagueMembers.userId),
          isNull(leagueMembers.removedAt),
        ),
      )
      .returning(managedMemberSelection);
    const row = promoted[0];
    if (row === undefined) throw conflict('member is not eligible for ownership');
    return row;
  });
}
