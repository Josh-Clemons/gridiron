import { z } from 'zod';
import { displayNameSchema } from './auth';
import { idSchema, poolSchema, seasonYearSchema } from './common';

/**
 * One name on the honours board.
 *
 * `memberId` is null for the many champions who predate anything we can import — the
 * list runs to 2007 and the oldest readable workbook is 2020 — and `totalPoints` is
 * null where the sheet recorded a winner but no score.
 */
export const championSchema = z.object({
  year: seasonYearSchema,
  pool: poolSchema,
  displayName: displayNameSchema,
  /** Set when the champion is still on the roster, so the name can link to them. */
  memberId: idSchema.nullable(),
  totalPoints: z.int().nonnegative().nullable(),
  note: z.string().nullable(),
});

/**
 * A year, and whoever won it.
 *
 * `champions` is usually one name, two when a year ties — 2022 ended with Kevin
 * Fournier and Meaghan Olender both on 146 — and **empty for a year that was never
 * won**: the 2018 playoff pool played no game. Every year between the pool's first and
 * last appears, so a gap is a rendered row rather than a silently missing one.
 */
export const championYearSchema = z.object({
  year: seasonYearSchema,
  champions: z.array(championSchema),
});

export const championPoolSchema = z.object({
  pool: poolSchema,
  /** Newest first — the interesting end of a list this long. */
  years: z.array(championYearSchema),
});

export const championsSchema = z.object({
  pools: z.array(championPoolSchema),
});

export type Champion = z.infer<typeof championSchema>;
export type ChampionYear = z.infer<typeof championYearSchema>;
export type ChampionPool = z.infer<typeof championPoolSchema>;
export type Champions = z.infer<typeof championsSchema>;
