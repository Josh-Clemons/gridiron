import { randomInt } from 'node:crypto';
import { leagueMembers, leagues, picks } from '@gridiron/schema';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Deps } from '../deps';
import { conflict, forbidden, notFound } from '../http/errors';
import { isUniqueViolation } from './db-errors';

/** No I, O, 0 or 1 — these get read aloud and retyped from a phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

function generateInviteCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

export interface Membership {
  readonly leagueId: number;
  readonly memberId: number;
  /** The member's roster label — what the correction log records as "who acted". */
  readonly displayName: string;
  readonly role: 'owner' | 'member';
  readonly leagueName: string;
  readonly inviteCode: string;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
}

/**
 * The caller's membership in a league, or a 404.
 *
 * Every league-scoped route starts here, and picks hang off the returned `memberId` —
 * so a caller can only ever address their own row. Non-members get "not found" rather
 * than "forbidden": leagues are private, and confirming one exists to someone without
 * the invite code is itself a leak.
 */
export async function requireMembership(
  deps: Deps,
  leagueId: number,
  userId: number,
): Promise<Membership> {
  const rows = await deps.db
    .select({
      leagueId: leagues.id,
      memberId: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
      leagueName: leagues.name,
      inviteCode: leagues.inviteCode,
      createdAt: leagues.createdAt,
      archivedAt: leagues.archivedAt,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        eq(leagueMembers.userId, userId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw notFound('league not found');
  return row;
}

export async function countMembers(deps: Deps, leagueId: number): Promise<number> {
  const rows = await deps.db
    .select({ total: count() })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.removedAt)));
  return rows[0]?.total ?? 0;
}

/**
 * The caller must own the league.
 *
 * The Phase 7 commissioner tools all sit behind this. It takes the membership that
 * `requireMembership` already resolved, so an admin route is two gates: a non-member
 * is told nothing exists at the first, and a plain member is turned away at the
 * second — by then the league's existence is no secret to them.
 */
export function requireOwner(membership: Membership): Membership {
  if (membership.role !== 'owner') throw forbidden('only the owner can do that');
  return membership;
}

export interface MemberRow {
  readonly id: number;
  readonly displayName: string;
  readonly role: 'owner' | 'member';
  readonly userId: number | null;
}

/**
 * A specific active member of a league, or a 404.
 *
 * The target of a correction: it must be a real, current member of the same league.
 * Like `requireMembership`, the not-found wording deliberately does not say which
 * half of the ask was wrong.
 */
export async function requireMember(
  deps: Deps,
  leagueId: number,
  memberId: number,
): Promise<MemberRow> {
  const rows = await deps.db
    .select({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
      userId: leagueMembers.userId,
    })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.id, memberId),
        eq(leagueMembers.leagueId, leagueId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw notFound('member not found');
  return row;
}

export function listMemberships(deps: Deps, userId: number): Promise<Membership[]> {
  return deps.db
    .select({
      leagueId: leagues.id,
      memberId: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
      leagueName: leagues.name,
      inviteCode: leagues.inviteCode,
      createdAt: leagues.createdAt,
      archivedAt: leagues.archivedAt,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.userId, userId), isNull(leagueMembers.removedAt)))
    .orderBy(leagues.name);
}

/**
 * Create a league with the caller as owner.
 *
 * The invite code is retried on collision rather than assumed unique: 40 bits is
 * plenty, but the unique index is the actual guarantee and this loop is what makes
 * that guarantee non-fatal.
 */
export async function createLeague(
  deps: Deps,
  userId: number,
  name: string,
  displayName: string,
): Promise<Membership> {
  /* eslint-disable no-await-in-loop --
   * Retries are inherently sequential: each attempt has to see whether the previous
   * code collided before generating another. There is nothing to parallelise. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      return await deps.db.transaction(async (tx) => {
        const [league] = await tx.insert(leagues).values({ name, inviteCode }).returning();
        if (league === undefined) throw new Error('league insert returned nothing');

        const [member] = await tx
          .insert(leagueMembers)
          .values({ leagueId: league.id, userId, displayName, role: 'owner' })
          .returning();
        if (member === undefined) throw new Error('member insert returned nothing');

        return {
          leagueId: league.id,
          memberId: member.id,
          displayName: member.displayName,
          role: 'owner' as const,
          leagueName: league.name,
          inviteCode: league.inviteCode,
          createdAt: league.createdAt,
          archivedAt: league.archivedAt,
        };
      });
    } catch (error) {
      if (!isUniqueViolation(error, 'leagues_invite_code_key')) throw error;
    }
  }
  /* eslint-enable no-await-in-loop */
  throw conflict('could not allocate an invite code');
}

export interface JoinPreview {
  readonly leagueId: number;
  readonly leagueName: string;
  readonly memberCount: number;
  readonly alreadyMember: boolean;
  readonly unclaimed: readonly { id: number; displayName: string; pickCount: number }[];
}

/**
 * What an invite code reveals before joining.
 *
 * The unclaimed list is the whole point: the importer creates a roster slot per name
 * in the commissioner's workbook, so a player who signs up in week 6 finds their own
 * five weeks of history sitting there and takes it over.
 */
export async function previewJoin(deps: Deps, code: string, userId: number): Promise<JoinPreview> {
  const rows = await deps.db.select().from(leagues).where(eq(leagues.inviteCode, code)).limit(1);
  const league = rows[0];
  if (league === undefined) throw notFound('invalid invite code');

  const unclaimed = await deps.db
    .select({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      pickCount: count(picks.id),
    })
    .from(leagueMembers)
    .leftJoin(picks, and(eq(picks.leagueMemberId, leagueMembers.id), isNull(picks.deletedAt)))
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        isNull(leagueMembers.userId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .groupBy(leagueMembers.id, leagueMembers.displayName)
    .orderBy(leagueMembers.displayName);

  const mine = await deps.db
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        eq(leagueMembers.userId, userId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .limit(1);

  return {
    leagueId: league.id,
    leagueName: league.name,
    memberCount: await countMembers(deps, league.id),
    alreadyMember: mine.length > 0,
    unclaimed,
  };
}

export interface JoinInput {
  readonly inviteCode: string;
  readonly claimMemberId?: number;
  readonly displayName?: string;
}

/**
 * Join by invite code, optionally claiming an imported roster slot.
 *
 * Claiming is a conditional update — `where user_id is null` — so two people racing
 * for the same name can't both win it; the loser gets a conflict rather than a
 * silently shared membership. Re-joining a league you're already in is a no-op, which
 * makes the endpoint safe to retry.
 */
export async function joinLeague(
  deps: Deps,
  userId: number,
  accountName: string,
  input: JoinInput,
): Promise<Membership> {
  const rows = await deps.db
    .select()
    .from(leagues)
    .where(eq(leagues.inviteCode, input.inviteCode))
    .limit(1);
  const league = rows[0];
  if (league === undefined) throw notFound('invalid invite code');

  const existing = await deps.db
    .select({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
    })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        eq(leagueMembers.userId, userId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .limit(1);

  const asMembership = (
    memberId: number,
    role: 'owner' | 'member',
    displayName: string,
  ): Membership => ({
    leagueId: league.id,
    memberId,
    displayName,
    role,
    leagueName: league.name,
    inviteCode: league.inviteCode,
    createdAt: league.createdAt,
    archivedAt: league.archivedAt,
  });

  const already = existing[0];
  if (already !== undefined) return asMembership(already.id, already.role, already.displayName);

  if (input.claimMemberId !== undefined) {
    const claimed = await deps.db
      .update(leagueMembers)
      .set({ userId })
      .where(
        and(
          eq(leagueMembers.id, input.claimMemberId),
          eq(leagueMembers.leagueId, league.id),
          isNull(leagueMembers.userId),
          isNull(leagueMembers.removedAt),
        ),
      )
      .returning({
        id: leagueMembers.id,
        displayName: leagueMembers.displayName,
        role: leagueMembers.role,
      });

    const row = claimed[0];
    if (row === undefined) throw conflict('that roster slot is not available');
    return asMembership(row.id, row.role, row.displayName);
  }

  const inserted = await deps.db
    .insert(leagueMembers)
    .values({
      leagueId: league.id,
      userId,
      displayName: input.displayName ?? accountName,
      role: 'member',
    })
    .returning({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
    });

  const row = inserted[0];
  if (row === undefined) throw new Error('member insert returned nothing');
  return asMembership(row.id, row.role, row.displayName);
}

/**
 * Leave a league.
 *
 * The roster slot is kept and its picks with it — only the link to the account is
 * cut — so standings for played weeks stay intact and a commissioner can hand the
 * slot back later. The last owner can't walk out on a league with members still in
 * it; ownership transfer is a Phase 7 tool.
 */
export async function leaveLeague(deps: Deps, membership: Membership): Promise<void> {
  if (membership.role === 'owner') {
    const total = await countMembers(deps, membership.leagueId);
    if (total > 1) throw forbidden('transfer ownership before leaving');
  }
  await deps.db
    .update(leagueMembers)
    .set({ removedAt: deps.now(), userId: null })
    .where(eq(leagueMembers.id, membership.memberId));
}

/** Members of a league, newest-joined last. Display names only — never emails. */
export function listMembers(deps: Deps, leagueId: number) {
  return deps.db
    .select({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      role: leagueMembers.role,
      userId: leagueMembers.userId,
      joinedAt: leagueMembers.joinedAt,
    })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.removedAt)))
    .orderBy(sql`lower(${leagueMembers.displayName})`);
}
