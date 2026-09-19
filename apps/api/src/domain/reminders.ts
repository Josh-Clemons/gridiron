import { loadGames } from '../data/picks';
import { membersNeedingReminder, recordReminder } from '../data/reminders';
import { currentWeek, resolveSeason } from '../data/seasons';
import type { Deps } from '../deps';
import { groupGamesByWeek } from './standings';

/** Remind this far ahead of a kickoff — "15 minutes before the noon game". */
const REMINDER_LEAD_MS = 15 * 60_000;

export interface ReminderResult {
  /** Emails actually sent this run. */
  readonly sent: number;
  /** True when it wasn't reminder time yet — no kickoff within the window. */
  readonly notYet: boolean;
}

/**
 * Remind members who haven't finished their picks, 15 minutes before the next kickoff.
 *
 * The window opens when the live week's earliest still-upcoming kickoff is within
 * {@link REMINDER_LEAD_MS}. On a normal week that kickoff is the Sunday noon game, so
 * this fires around 11:45 — but a Thursday-night game makes it fire before Thursday
 * instead, which is exactly when a Thursday pick first locks (rule 9).
 *
 * One email per member per week, enforced by the `pick_reminders` unique index rather
 * than by trusting the schedule to run the job once. Safe to run every quarter hour.
 */
export async function runReminders(deps: Deps): Promise<ReminderResult> {
  const season = await resolveSeason(deps);
  const week = await currentWeek(deps, season);
  const now = deps.now();

  const games = await loadGames(deps, season.id);
  const weekGames = groupGamesByWeek(games).get(week) ?? [];

  const nextKickoff = weekGames
    .filter((game) => game.status !== 'final' && game.kickoff.getTime() > now.getTime())
    .map((game) => game.kickoff.getTime())
    .toSorted((a, b) => a - b)[0];

  if (nextKickoff === undefined || nextKickoff - now.getTime() > REMINDER_LEAD_MS) {
    return { sent: 0, notYet: true };
  }

  const targets = await membersNeedingReminder(deps, season.id, week);
  const minutes = Math.max(1, Math.round((nextKickoff - now.getTime()) / 60_000));

  await Promise.all(
    targets.map(async (target) => {
      await deps.mailer.send({
        to: target.email,
        subject: `Gridiron: finish your week ${String(week)} picks`,
        text: [
          `Hi ${target.displayName},`,
          '',
          `You've made ${String(target.made)} of your three picks for week ${String(week)} in ${target.leagueName}, and the next game kicks off in about ${String(minutes)} minutes.`,
          '',
          `Pick them now: ${deps.config.appUrl}/leagues/${String(target.leagueId)}`,
          '',
          '— Gridiron',
        ].join('\n'),
      });
      await recordReminder(deps, target.memberId, season.id, week);
    }),
  );

  return { sent: targets.length, notYet: false };
}
