import { leagueMembers, leagues, pickReminders, picks, users } from '@gridiron/schema';
import { and, count, eq, isNull, lt } from 'drizzle-orm';
import type { Deps } from '../deps';

/** Someone who needs a nudge: an account, in a league, behind on the week's picks. */
export interface ReminderTarget {
  readonly memberId: number;
  readonly leagueId: number;
  readonly email: string;
  readonly displayName: string;
  readonly leagueName: string;
  /** How many of the three slots are filled. */
  readonly made: number;
}

/**
 * Every claimed, active member who hasn't finished their three picks this week and
 * hasn't been reminded yet.
 *
 * Unclaimed roster slots — the spreadsheet players with no account — have no email to
 * reach, so they are naturally excluded by the `users` join. Reminded members are
 * excluded by the `pick_reminders` left join: a reminder is one per member per week,
 * and the row is what guarantees that even a job firing every quarter hour sends it
 * once.
 */
export async function membersNeedingReminder(
  deps: Deps,
  seasonId: number,
  week: number,
): Promise<ReminderTarget[]> {
  const rows = await deps.db
    .select({
      memberId: leagueMembers.id,
      leagueId: leagueMembers.leagueId,
      email: users.email,
      displayName: leagueMembers.displayName,
      leagueName: leagues.name,
      made: count(picks.id),
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .leftJoin(
      picks,
      and(
        eq(picks.leagueMemberId, leagueMembers.id),
        eq(picks.seasonId, seasonId),
        eq(picks.week, week),
        isNull(picks.deletedAt),
      ),
    )
    .leftJoin(
      pickReminders,
      and(
        eq(pickReminders.leagueMemberId, leagueMembers.id),
        eq(pickReminders.seasonId, seasonId),
        eq(pickReminders.week, week),
      ),
    )
    .where(and(isNull(leagueMembers.removedAt), isNull(pickReminders.id)))
    .groupBy(
      leagueMembers.id,
      leagueMembers.leagueId,
      users.email,
      leagueMembers.displayName,
      leagues.name,
    )
    .having(lt(count(picks.id), 3));

  return rows.map((row) => ({
    memberId: row.memberId,
    leagueId: row.leagueId,
    email: row.email,
    displayName: row.displayName,
    leagueName: row.leagueName,
    made: row.made,
  }));
}

/**
 * Record that a member was reminded.
 *
 * `onConflictDoNothing` against the unique `(member, season, week)` index: a run that
 * is retried after a partial failure can't double-send, because the rows it already
 * wrote make the later inserts no-ops.
 */
export async function recordReminder(
  deps: Deps,
  memberId: number,
  seasonId: number,
  week: number,
): Promise<void> {
  await deps.db
    .insert(pickReminders)
    .values({ leagueMemberId: memberId, seasonId, week, sentAt: deps.now() })
    .onConflictDoNothing();
}
