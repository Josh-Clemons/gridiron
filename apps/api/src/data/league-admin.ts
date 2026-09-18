import { leagues } from '@gridiron/schema';
import { eq } from 'drizzle-orm';
import type { Deps } from '../deps';
import { conflict, notFound } from '../http/errors';
import { isUniqueViolation } from './db-errors';
import { generateInviteCode } from './leagues';

/** The league columns an admin action changes and reads back. */
export interface LeagueAdminRow {
  readonly id: number;
  readonly name: string;
  readonly inviteCode: string;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
}

const selection = {
  id: leagues.id,
  name: leagues.name,
  inviteCode: leagues.inviteCode,
  createdAt: leagues.createdAt,
  archivedAt: leagues.archivedAt,
};

export async function renameLeagueRow(
  deps: Deps,
  leagueId: number,
  name: string,
): Promise<LeagueAdminRow> {
  const rows = await deps.db
    .update(leagues)
    .set({ name })
    .where(eq(leagues.id, leagueId))
    .returning(selection);
  const row = rows[0];
  if (row === undefined) throw notFound('league not found');
  return row;
}

/**
 * Replace the invite code.
 *
 * Same retry-on-collision loop as `createLeague`: 40 bits is plenty, but the unique
 * index is the actual guarantee and this loop makes that guarantee non-fatal.
 */
export async function regenerateInviteCode(deps: Deps, leagueId: number): Promise<string> {
  /* eslint-disable no-await-in-loop --
   * Retries are inherently sequential: each attempt has to see whether the previous
   * code collided before generating another. There is nothing to parallelise. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      const rows = await deps.db
        .update(leagues)
        .set({ inviteCode })
        .where(eq(leagues.id, leagueId))
        .returning({ id: leagues.id });
      if (rows[0] === undefined) throw notFound('league not found');
      return inviteCode;
    } catch (error) {
      if (!isUniqueViolation(error, 'leagues_invite_code_key')) throw error;
    }
  }
  /* eslint-enable no-await-in-loop */
  throw conflict('could not allocate an invite code');
}

/** Archive freezes picks; unarchiving rolls the league into the next season. */
export async function setLeagueArchived(
  deps: Deps,
  leagueId: number,
  archived: boolean,
  now: Date,
): Promise<LeagueAdminRow> {
  const rows = await deps.db
    .update(leagues)
    .set({ archivedAt: archived ? now : null })
    .where(eq(leagues.id, leagueId))
    .returning(selection);
  const row = rows[0];
  if (row === undefined) throw notFound('league not found');
  return row;
}
