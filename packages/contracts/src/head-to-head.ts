import { z } from 'zod';
import { displayNameSchema } from './auth';
import { idSchema, seasonYearSchema, weekSchema } from './common';
import { seasonSchema } from './picks';

/** Query string: which two members, of which season. */
export const headToHeadQuerySchema = z.object({
  season: z.coerce.number().pipe(seasonYearSchema).optional(),
  a: z.coerce.number().pipe(idSchema),
  b: z.coerce.number().pipe(idSchema),
});

/** One side of the comparison. `points[0]` is week 1, like the history grid. */
export const headToHeadMemberSchema = z.object({
  memberId: idSchema,
  displayName: displayNameSchema,
  points: z.array(z.int().nonnegative()),
  seasonPoints: z.int().nonnegative(),
});

export const headToHeadSchema = z.object({
  season: seasonSchema,
  /** The season's weeks in order; `settled` marks a week every game is final. */
  weeks: z.array(z.object({ week: weekSchema, settled: z.boolean() })),
  a: headToHeadMemberSchema,
  b: headToHeadMemberSchema,
  /**
   * Over settled weeks only: the higher score takes the week, an equal score is a tie,
   * and an unplayed week counts for neither side.
   */
  record: z.object({
    aWins: z.int().nonnegative(),
    bWins: z.int().nonnegative(),
    ties: z.int().nonnegative(),
  }),
});

export type HeadToHeadQuery = z.infer<typeof headToHeadQuerySchema>;
export type HeadToHead = z.infer<typeof headToHeadSchema>;
