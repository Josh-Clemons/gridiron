import { SLOTS, SLOT_POINTS, TRIFECTA_BONUS } from './constants';
import { findGame } from './games';
import type { Game, Pick, Slot, TeamId } from './types';

/**
 * - `win`     — team won; slot scores its points
 * - `loss`    — team lost or tied (rule 7); scores 0
 * - `pending` — game not final yet, or no game found for the pick
 * - `empty`   — no pick in this slot
 *
 * A rejected import and a slot the player simply never filled both end up `empty`,
 * which is correct: neither scores.
 */
export type PickOutcome = 'win' | 'loss' | 'pending' | 'empty';

export interface SlotResult {
  readonly slot: Slot;
  readonly teamId: TeamId | null;
  readonly outcome: PickOutcome;
  readonly points: number;
}

export interface WeekScore {
  readonly week: number;
  readonly slots: readonly SlotResult[];
  /** Points from the picks themselves, before the Trifecta bonus. */
  readonly base: number;
  readonly trifecta: number;
  readonly total: number;
  /** No slot is still pending, so this week's score is final. */
  readonly settled: boolean;
}

/**
 * Score one week.
 *
 * Pure and total: the same picks and games always give the same answer, so standings
 * can be recomputed from scratch at any time rather than incrementally mutated. That
 * is what makes the result sync safe to re-run.
 */
export function scoreWeek(week: number, picks: readonly Pick[], games: readonly Game[]): WeekScore {
  const weekPicks = picks.filter((pick) => pick.week === week);

  const slots: SlotResult[] = SLOTS.map((slot) => {
    const pick = weekPicks.find((candidate) => candidate.slot === slot);
    if (pick === undefined) {
      return { slot, teamId: null, outcome: 'empty', points: 0 };
    }

    const game = findGame(games, week, pick.teamId);
    if (game === undefined || game.status !== 'final') {
      return { slot, teamId: pick.teamId, outcome: 'pending', points: 0 };
    }

    // `winner === null` is a tie, which rule 7 treats as a loss.
    const won = game.winner === pick.teamId;
    return {
      slot,
      teamId: pick.teamId,
      outcome: won ? 'win' : 'loss',
      points: won ? SLOT_POINTS[slot] : 0,
    };
  });

  const base = slots.reduce((sum, slot) => sum + slot.points, 0);
  const trifecta = slots.every((slot) => slot.outcome === 'win') ? TRIFECTA_BONUS : 0;
  const settled = slots.every((slot) => slot.outcome !== 'pending');

  return { week, slots, base, trifecta, total: base + trifecta, settled };
}

export interface SeasonScore {
  readonly weeks: readonly WeekScore[];
  readonly total: number;
}

/**
 * Score a whole season.
 *
 * `weekCount` comes from the season record rather than a constant — the NFL played
 * 17 weeks through 2020 and 18 from 2021, and the historical workbooks include both.
 */
export function scoreSeason(
  picks: readonly Pick[],
  games: readonly Game[],
  weekCount: number,
): SeasonScore {
  const weeks: WeekScore[] = [];
  for (let week = 1; week <= weekCount; week += 1) {
    weeks.push(scoreWeek(week, picks, games));
  }
  return { weeks, total: weeks.reduce((sum, week) => sum + week.total, 0) };
}
