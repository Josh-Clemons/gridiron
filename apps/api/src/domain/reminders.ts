import { loadGames } from '../data/picks';
import { membersNeedingReminder, recordReminder } from '../data/reminders';
import { currentWeek, resolveSeason } from '../data/seasons';
import type { Deps } from '../deps';
import { groupGamesByWeek } from './standings';

/** Remind this far ahead of a kickoff — "15 minutes before the noon game". */
const REMINDER_LEAD_MS = 15 * 60_000;

/**
 * Weekday in the league's timezone (America/Chicago), host-TZ independent.
 *
 * Kickoffs are UTC instants; "Sunday" has to mean Sunday in Chicago, not Sunday on
 * whatever machine happens to run the job. `Intl` asks the calendar rather than the
 * process clock, so the answer is the same in the container, in a test, and on a
 * laptop set to some other zone.
 */
const chicagoWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
});

const isSundayInChicago = (instant: Date): boolean => chicagoWeekday.format(instant) === 'Sun';

export interface ReminderResult {
  /** Emails actually sent this run. */
  readonly sent: number;
  /** True when it wasn't reminder time yet — no kickoff within the window. */
  readonly notYet: boolean;
}

/**
 * Remind members who haven't finished their picks, 15 minutes before the Sunday games.
 *
 * The league makes its picks against the Sunday slate, when the majority of games
 * play, so Thursday-night and Monday-night games are deliberately not a trigger: the
 * window opens when the live week's earliest still-upcoming *Sunday* kickoff is within
 * {@link REMINDER_LEAD_MS}. In a normal week that kickoff is the noon game, and the
 * reminder fires around 11:45 Central.
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

  const nextSundayKickoff = weekGames
    .filter(
      (game) =>
        game.status !== 'final' &&
        isSundayInChicago(game.kickoff) &&
        game.kickoff.getTime() > now.getTime(),
    )
    .map((game) => game.kickoff.getTime())
    .toSorted((a, b) => a - b)[0];

  if (nextSundayKickoff === undefined || nextSundayKickoff - now.getTime() > REMINDER_LEAD_MS) {
    return { sent: 0, notYet: true };
  }

  const targets = await membersNeedingReminder(deps, season.id, week);
  const minutes = Math.max(1, Math.round((nextSundayKickoff - now.getTime()) / 60_000));

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
