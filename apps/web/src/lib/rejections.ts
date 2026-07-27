import type { PickRejectionWire } from '@gridiron/contracts';
import { describeRejection, type PickRejection } from '@gridiron/rules';
import { formatKickoff } from './format';

/**
 * Why an option is unavailable, in words.
 *
 * The wording comes from the rules engine, not from here — `describeRejection` is the
 * same function the API and the importer use, so the tooltip on a greyed-out team and
 * the error the server would have returned are the same sentence. The one thing this
 * adds is a local kickoff time: the engine renders it as an ISO instant, which is
 * correct for a log and unreadable on a phone.
 */
export function reasonFor(rejection: PickRejection): string {
  if (rejection.code === 'game_locked') {
    return `${rejection.teamId} kicked off ${formatKickoff(rejection.kickoff)}`;
  }
  return describeRejection(rejection);
}

/** The same, for a rejection that arrived from the API rather than the local engine. */
export function reasonForWire(rejection: PickRejectionWire): string {
  if (rejection.code === 'game_locked') {
    return `${rejection.teamId} kicked off ${formatKickoff(new Date(rejection.kickoff))}`;
  }
  return rejection.message;
}
