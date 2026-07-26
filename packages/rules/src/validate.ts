import { SLOT_LABELS } from './constants';
import { findGame, isLocked, opponentOf } from './games';
import type { Game, Pick, Slot, TeamId } from './types';

/**
 * Why a pick isn't allowed.
 *
 * A discriminated union rather than a string so callers can render their own wording:
 * the web app shows these as tooltips on greyed-out options, and the importer groups
 * them by `code` in its rejection report.
 */
export type PickRejection =
  | { readonly code: 'team_not_playing'; readonly teamId: TeamId; readonly week: number }
  | { readonly code: 'game_locked'; readonly teamId: TeamId; readonly kickoff: Date }
  | {
      readonly code: 'slot_used_this_season';
      readonly teamId: TeamId;
      readonly slot: Slot;
      readonly usedInWeek: number;
    }
  | {
      readonly code: 'duplicate_team_this_week';
      readonly teamId: TeamId;
      readonly otherSlot: Slot;
    }
  | {
      readonly code: 'same_game_as_other_pick';
      readonly teamId: TeamId;
      readonly otherSlot: Slot;
      readonly otherTeamId: TeamId;
    };

export type ValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly rejections: readonly PickRejection[] };

export interface ValidatePickInput {
  /**
   * Every pick this player already holds for the season. A pick occupying the same
   * week and slot as the one being made is treated as the value being replaced, not
   * as a conflict.
   */
  readonly seasonPicks: readonly Pick[];
  /** The season's schedule. Only the target week is consulted. */
  readonly games: readonly Game[];
  readonly week: number;
  readonly slot: Slot;
  readonly teamId: TeamId;
  readonly now: Date;
  /**
   * Skip the kickoff check. The importer sets this when loading weeks that have
   * already been played; nothing in the app's own write path should.
   */
  readonly ignoreLock?: boolean;
}

/**
 * Check a single pick against every rule.
 *
 * Returns *all* reasons it fails rather than the first, because a pick can break more
 * than one rule at once and the importer's report is more useful when it says so.
 */
export function validatePick(input: ValidatePickInput): ValidationResult {
  const { seasonPicks, games, week, slot, teamId, now, ignoreLock = false } = input;
  const rejections: PickRejection[] = [];

  const game = findGame(games, week, teamId);
  if (game === undefined) {
    rejections.push({ code: 'team_not_playing', teamId, week });
  } else if (!ignoreLock && isLocked(game, now)) {
    rejections.push({ code: 'game_locked', teamId, kickoff: game.kickoff });
  }

  // The pick being replaced is not a conflict with itself.
  const others = seasonPicks.filter((pick) => !(pick.week === week && pick.slot === slot));

  // Rule 6 — a team may be used only once per slot per season.
  const sameSlotUse = others.find((pick) => pick.slot === slot && pick.teamId === teamId);
  if (sameSlotUse !== undefined) {
    rejections.push({
      code: 'slot_used_this_season',
      teamId,
      slot,
      usedInWeek: sameSlotUse.week,
    });
  }

  const thisWeek = others.filter((pick) => pick.week === week);

  // Rule 2 — the three teams in a week must be different.
  const duplicate = thisWeek.find((pick) => pick.teamId === teamId);
  if (duplicate !== undefined) {
    rejections.push({ code: 'duplicate_team_this_week', teamId, otherSlot: duplicate.slot });
  }

  // Rule 8 — never both sides of the same game.
  if (game !== undefined) {
    const opponent = opponentOf(game, teamId);
    if (opponent !== undefined) {
      const conflict = thisWeek.find((pick) => pick.teamId === opponent);
      if (conflict !== undefined) {
        rejections.push({
          code: 'same_game_as_other_pick',
          teamId,
          otherSlot: conflict.slot,
          otherTeamId: opponent,
        });
      }
    }
  }

  return rejections.length > 0 ? { ok: false, rejections } : { ok: true };
}

/**
 * Human-readable wording for a rejection.
 *
 * Kept here so the UI tooltip and the importer report can't drift apart.
 */
export function describeRejection(rejection: PickRejection): string {
  switch (rejection.code) {
    case 'team_not_playing':
      return `${rejection.teamId} has no game in week ${String(rejection.week)}`;
    case 'game_locked':
      return `${rejection.teamId} kicked off at ${rejection.kickoff.toISOString()}`;
    case 'slot_used_this_season':
      return `${rejection.teamId} was already used at ${SLOT_LABELS[rejection.slot]} in week ${String(rejection.usedInWeek)}`;
    case 'duplicate_team_this_week':
      return `${rejection.teamId} is already this week's ${SLOT_LABELS[rejection.otherSlot]} pick`;
    case 'same_game_as_other_pick':
      return `${rejection.teamId} plays ${rejection.otherTeamId}, this week's ${SLOT_LABELS[rejection.otherSlot]} pick`;
    default: {
      // Adding a rejection code without a message here is a compile error.
      const unhandled: never = rejection;
      return String(unhandled);
    }
  }
}
