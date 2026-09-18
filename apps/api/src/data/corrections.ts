import type { Slot } from '@gridiron/rules';
import { leagueMembers, pickCorrections } from '@gridiron/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Deps } from '../deps';
import type { DbOrTx } from './picks';
import type { SeasonRow } from './seasons';

export interface RecordCorrectionInput {
  readonly leagueId: number;
  /** The commissioner on duty. */
  readonly actorMemberId: number;
  /** The member whose pick was corrected. */
  readonly targetMemberId: number;
  readonly seasonId: number;
  readonly week: number;
  readonly slot: Slot;
  /** Team id the slot held before, null when it was empty. */
  readonly fromTeamId: number | null;
  /** Team id written, null when the correction cleared the slot. */
  readonly toTeamId: number | null;
  readonly reason: string;
}

/**
 * Append one row to the correction log.
 *
 * Takes a `DbOrTx` because it is always called from inside the same transaction as
 * the pick write it describes — a pick changed with no record of why is worse than
 * either half alone. The row is never updated afterwards; there is no path that does.
 */
export async function recordCorrection(
  db: DbOrTx,
  input: RecordCorrectionInput,
): Promise<{ readonly id: number; readonly createdAt: Date }> {
  const rows = await db
    .insert(pickCorrections)
    .values({
      leagueId: input.leagueId,
      actorMemberId: input.actorMemberId,
      targetMemberId: input.targetMemberId,
      seasonId: input.seasonId,
      week: input.week,
      slot: input.slot,
      fromTeamId: input.fromTeamId,
      toTeamId: input.toTeamId,
      reason: input.reason,
    })
    .returning({ id: pickCorrections.id, createdAt: pickCorrections.createdAt });

  const row = rows[0];
  if (row === undefined) throw new Error('correction insert returned nothing');
  return row;
}

export interface CorrectionRow {
  readonly id: number;
  readonly actorMemberId: number;
  readonly actorName: string;
  readonly targetMemberId: number;
  readonly targetName: string;
  readonly week: number;
  readonly slot: Slot;
  readonly fromTeamId: string | null;
  readonly toTeamId: string | null;
  readonly reason: string;
  readonly createdAt: Date;
}

/**
 * A season's correction log, newest first.
 *
 * Names are resolved in JS from a second narrow query rather than joined: the actor
 * or target may since have left the league, so the member lookup deliberately ignores
 * `removed_at`, and a partial select over a left join is the shape this repo's
 * TypeScript and Drizzle disagree about anyway (see `listSeasons`).
 */
export async function listCorrections(
  deps: Deps,
  leagueId: number,
  season: SeasonRow,
): Promise<CorrectionRow[]> {
  const catalog = await deps.teams();
  const [rows, memberRows] = await Promise.all([
    deps.db
      .select({
        id: pickCorrections.id,
        actorMemberId: pickCorrections.actorMemberId,
        targetMemberId: pickCorrections.targetMemberId,
        week: pickCorrections.week,
        slot: pickCorrections.slot,
        fromTeamId: pickCorrections.fromTeamId,
        toTeamId: pickCorrections.toTeamId,
        reason: pickCorrections.reason,
        createdAt: pickCorrections.createdAt,
      })
      .from(pickCorrections)
      .where(and(eq(pickCorrections.leagueId, leagueId), eq(pickCorrections.seasonId, season.id)))
      .orderBy(desc(pickCorrections.id)),
    deps.db
      .select({ id: leagueMembers.id, displayName: leagueMembers.displayName })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId)),
  ]);

  const nameById = new Map(memberRows.map((member) => [member.id, member.displayName]));
  const nameOf = (memberId: number): string =>
    nameById.get(memberId) ?? `member ${String(memberId)}`;
  const codeOf = (teamId: number | null): string | null =>
    teamId === null ? null : catalog.codeFor(teamId);

  return rows.map((row) => ({
    id: row.id,
    actorMemberId: row.actorMemberId,
    actorName: nameOf(row.actorMemberId),
    targetMemberId: row.targetMemberId,
    targetName: nameOf(row.targetMemberId),
    week: row.week,
    slot: row.slot,
    fromTeamId: codeOf(row.fromTeamId),
    toTeamId: codeOf(row.toTeamId),
    reason: row.reason,
    createdAt: row.createdAt,
  }));
}
