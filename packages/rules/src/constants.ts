import type { Slot } from './types';

/** Slots in descending point order, which is also the order they're displayed. */
export const SLOTS: readonly Slot[] = ['win', 'place', 'show'];

export const SLOT_POINTS: Readonly<Record<Slot, number>> = {
  win: 5,
  place: 3,
  show: 1,
};

export const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  win: 'Win',
  place: 'Place',
  show: 'Show',
};

/** Awarded when all three picks in a week win (rule 5). */
export const TRIFECTA_BONUS = 2;

/** 5 + 3 + 1 + 2 = 11. */
export const MAX_WEEK_SCORE =
  SLOT_POINTS.win + SLOT_POINTS.place + SLOT_POINTS.show + TRIFECTA_BONUS;
