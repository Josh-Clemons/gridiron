import { z } from 'zod';
import { displayNameSchema } from './auth';
import { idSchema, weekSchema } from './common';
import { seasonSchema } from './picks';

/**
 * A season this league can be shown, newest first.
 *
 * `hasPicks` separates a year the league actually played from one that merely has a
 * schedule loaded: 2026 exists for everybody before a single pick is made, and the
 * history views have nothing to say about it.
 */
export const seasonSummarySchema = seasonSchema.extend({
  hasGames: z.boolean(),
  hasPicks: z.boolean(),
});

export const seasonsSchema = z.object({
  seasons: z.array(seasonSummarySchema),
});

/**
 * One member's whole season, week by week.
 *
 * `points` is positional — index 0 is the first entry in `weeks` — which keeps a
 * 72 × 18 grid to a few thousand integers instead of that many objects.
 */
export const seasonHistoryRowSchema = z.object({
  memberId: idSchema,
  displayName: displayNameSchema,
  claimed: z.boolean(),
  isSelf: z.boolean(),
  rank: z.int().positive(),
  seasonPoints: z.int().nonnegative(),
  points: z.array(z.int().nonnegative()),
});

export const seasonHistorySchema = z.object({
  season: seasonSchema,
  /**
   * The season's weeks in order. `settled` means every game in that week is final, so
   * the grid can tell "scored nothing" apart from "hasn't been played".
   */
  weeks: z.array(z.object({ week: weekSchema, settled: z.boolean() })),
  rows: z.array(seasonHistoryRowSchema),
});

export type SeasonSummary = z.infer<typeof seasonSummarySchema>;
export type Seasons = z.infer<typeof seasonsSchema>;
export type SeasonHistoryRow = z.infer<typeof seasonHistoryRowSchema>;
export type SeasonHistory = z.infer<typeof seasonHistorySchema>;
