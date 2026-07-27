import { z } from 'zod';
import { seasonYearSchema, weekSchema } from './common';

/**
 * Query strings arrive as text, so these coerce.
 *
 * `season` is optional everywhere and defaults server-side to the newest season on
 * record. Passing it explicitly is how the history views in later phases read a
 * finished year without any other change.
 */
export const seasonQuerySchema = z.object({
  season: z.coerce.number().pipe(seasonYearSchema).optional(),
});

export const weekQuerySchema = z.object({
  season: z.coerce.number().pipe(seasonYearSchema).optional(),
  /** Defaults to the current week: the earliest week that isn't fully final. */
  week: z.coerce.number().pipe(weekSchema).optional(),
});

/** Path parameters for a single slot write. */
export const pickPathSchema = z.object({
  week: z.coerce.number().pipe(weekSchema),
  slot: z.enum(['win', 'place', 'show']),
});

export type SeasonQuery = z.infer<typeof seasonQuerySchema>;
export type WeekQuery = z.infer<typeof weekQuerySchema>;
export type PickPath = z.infer<typeof pickPathSchema>;
