import { z } from 'zod';
import { displayNameSchema } from './auth';
import {
  idSchema,
  instantSchema,
  seasonYearSchema,
  slotSchema,
  teamCodeSchema,
  weekSchema,
} from './common';
import { pickSchema, seasonSchema, weekScoreSchema } from './picks';

/**
 * Commissioner tools — Phase 7.
 *
 * These contracts are deliberately separate from `picks.ts`: a correction is a
 * different act from a pick. The player writes their own slots; the owner writes
 * anyone's, after kickoff if need be, and every act is logged with a reason. The
 * schemas here describe that act.
 */

/** Correcting one slot of any member's week. */
export const correctPickRequestSchema = z.object({
  /** The team to write, or `null` to clear the slot — a pick that should score 0. */
  teamId: teamCodeSchema.nullable(),
  /** Why. Required and never edited after; the audit trail is the point of the feature. */
  reason: z.string().trim().min(3).max(500),
});

/** One row of the correction log, as the owner reads it. */
export const correctionSchema = z.object({
  id: idSchema,
  actorMemberId: idSchema,
  actorName: displayNameSchema,
  targetMemberId: idSchema,
  targetName: displayNameSchema,
  /** The season year the correction belongs to. */
  season: seasonYearSchema,
  week: weekSchema,
  slot: slotSchema,
  /** The team the slot held before, `null` when it was empty. */
  fromTeamId: teamCodeSchema.nullable(),
  /** The team written, `null` when the correction cleared the slot. */
  toTeamId: teamCodeSchema.nullable(),
  reason: z.string().min(1),
  createdAt: instantSchema,
});

/** The result of a correction. */
export const correctPickResponseSchema = z.object({
  /** The corrected member's pick, as the board would show it. Absent when cleared. */
  pick: pickSchema.optional(),
  /** The corrected member's week score, so the caller need not refetch a board. */
  weekScore: weekScoreSchema,
  correction: correctionSchema,
});

/** The correction log for a season, newest first. */
export const correctionsResponseSchema = z.object({
  season: seasonSchema,
  corrections: z.array(correctionSchema),
});

export type CorrectPickRequest = z.infer<typeof correctPickRequestSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type CorrectPickResponse = z.infer<typeof correctPickResponseSchema>;
export type CorrectionsResponse = z.infer<typeof correctionsResponseSchema>;
