/**
 * Times are always shown in the player's own zone. The pool spans four of them and a
 * kickoff is only useful as "when do I have to decide by".
 */
const kickoffFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatKickoff = (kickoff: Date): string => kickoffFormat.format(kickoff);

export const formatTime = (when: Date): string => timeFormat.format(when);

/**
 * How long until kickoff, coarse on purpose.
 *
 * "in 3 days" and "in 40m" are both actionable; a seconds-precise countdown on a
 * Tuesday is noise. Under an hour it goes to minutes, because that's when it matters.
 */
export function formatCountdown(kickoff: Date, now: Date): string {
  const ms = kickoff.getTime() - now.getTime();
  if (ms <= 0) return 'locked';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'seconds left';
  if (minutes < 60) return `${String(minutes)}m left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m left`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'tomorrow' : `${String(days)} days`;
}

/** `AWAY @ HOME`, the way a schedule is read aloud. */
export const matchup = (away: string, home: string): string => `${away} @ ${home}`;
