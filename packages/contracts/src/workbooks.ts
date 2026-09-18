import { z } from 'zod';
import { idSchema, instantSchema, seasonYearSchema, slotSchema } from './common';

/**
 * Workbook upload/validation contracts — Phase 7.
 *
 * The report shape mirrors the importer's `ImportResult` exactly: the API passes it
 * through untouched, so the confirmation screen reads the same findings the operator
 * would have seen on the CLI.
 */

const rejectionSchema = z.object({
  playerName: z.string(),
  week: z.number().int().positive(),
  slot: slotSchema,
  teamToken: z.string(),
  reasons: z.array(z.string()),
});

const conflictSchema = z.object({
  playerName: z.string(),
  week: z.number().int().positive(),
  slot: slotSchema,
  sheetTeam: z.string(),
  appTeam: z.string(),
});

const crossCheckSchema = z.object({
  playerName: z.string(),
  teamCode: z.string(),
  slot: slotSchema,
  scoresWeek: z.number().int().positive(),
  historyWeek: z.number().int().positive().nullable(),
  unreadable: z.string().optional(),
});

const scoringSchema = z.object({
  playerName: z.string(),
  kind: z.enum(['slot', 'trifecta', 'week', 'season']),
  week: z.number().int().positive().nullable(),
  slot: slotSchema.nullable(),
  teamCode: z.string().nullable(),
  sheet: z.number().nullable(),
  computed: z.number(),
});

const removalSchema = z.object({
  playerName: z.string(),
  week: z.number().int().positive(),
  slot: slotSchema,
  teamCode: z.string(),
});

export const workbookReportSchema = z.object({
  file: z.string(),
  leagueName: z.string(),
  year: seasonYearSchema,
  weekCount: z.number().int().positive(),
  playerCount: z.number().int().nonnegative(),
  picksInSheet: z.number().int().nonnegative(),
  importable: z.number().int().nonnegative(),
  written: z.object({
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }),
  membersCreated: z.array(z.string()),
  rejections: z.array(rejectionSchema),
  conflicts: z.array(conflictSchema),
  crossCheck: z.array(crossCheckSchema),
  scoring: z.array(scoringSchema),
  removals: z.array(removalSchema),
  applied: z.boolean(),
});

/** One uploaded workbook, with its latest report when one exists. */
export const workbookSchema = z.object({
  id: idSchema,
  originalName: z.string(),
  season: seasonYearSchema,
  report: workbookReportSchema.nullable(),
  appliedAt: instantSchema.nullable(),
  uploadedAt: instantSchema,
});

export const workbooksResponseSchema = z.object({
  workbooks: z.array(workbookSchema),
});

export type WorkbookReport = z.infer<typeof workbookReportSchema>;
export type Workbook = z.infer<typeof workbookSchema>;
export type WorkbooksResponse = z.infer<typeof workbooksResponseSchema>;
