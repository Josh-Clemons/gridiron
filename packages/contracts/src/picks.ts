import { z } from 'zod';
import { displayNameSchema } from './auth';
import {
  gameStatusSchema,
  idSchema,
  instantSchema,
  pickSourceSchema,
  seasonYearSchema,
  slotSchema,
  teamCodeSchema,
  weekSchema,
} from './common';

export const seasonSchema = z.object({
  id: idSchema,
  year: seasonYearSchema,
  weekCount: z.int().min(1).max(25),
});

export const gameSchema = z.object({
  id: idSchema,
  week: weekSchema,
  homeTeam: teamCodeSchema,
  awayTeam: teamCodeSchema,
  kickoff: instantSchema,
  status: gameStatusSchema,
  /** Null while unfinished, and also for a tie — which rule 7 scores as a loss. */
  winner: teamCodeSchema.nullable(),
  /** Kickoff has passed, so this game's slot can no longer be changed (rule 9). */
  locked: z.boolean(),
});

export const pickOutcomeSchema = z.enum(['win', 'loss', 'pending', 'empty']);

export const pickSchema = z.object({
  slot: slotSchema,
  week: weekSchema,
  teamId: teamCodeSchema,
  /** `import` means the commissioner's workbook supplied it, `correction` that the commissioner overrode it — neither came from this player tapping a button. */
  source: pickSourceSchema,
  outcome: pickOutcomeSchema,
  points: z.int().nonnegative(),
  locked: z.boolean(),
  updatedAt: instantSchema,
});

export const weekScoreSchema = z.object({
  week: weekSchema,
  base: z.int().nonnegative(),
  trifecta: z.int().nonnegative(),
  total: z.int().nonnegative(),
  settled: z.boolean(),
});

export const putPickRequestSchema = z.object({
  teamId: teamCodeSchema,
});

/**
 * The result of a single slot write.
 *
 * `weekScore` rides along so the pick page can update its score line from the write's
 * own response instead of refetching the board.
 */
export const putPickResponseSchema = z.object({
  pick: pickSchema,
  weekScore: weekScoreSchema,
});

export const deletePickResponseSchema = z.object({
  weekScore: weekScoreSchema,
});

/** One row of the standings table. Integers only — never another member's picks. */
export const standingRowSchema = z.object({
  memberId: idSchema,
  displayName: displayNameSchema,
  claimed: z.boolean(),
  isSelf: z.boolean(),
  weekPoints: z.int().nonnegative(),
  seasonPoints: z.int().nonnegative(),
  /** Ties share a rank, and the next rank skips accordingly (1, 2, 2, 4). */
  rank: z.int().positive(),
});

export const standingsSchema = z.object({
  season: seasonSchema,
  /** The week `weekPoints` refers to. */
  week: weekSchema,
  rows: z.array(standingRowSchema),
});

/**
 * Everything the pick page needs for one week, in one response.
 *
 * One week at a time is load-bearing: at 72 members and 18 weeks, shipping the whole
 * season's picks would be megabytes. This stays comfortably under 30 KB.
 */
export const boardSchema = z.object({
  season: seasonSchema,
  week: weekSchema,
  /**
   * Server time at the moment this was built. The client ticks its lock countdown
   * from this rather than the device clock, which may be minutes off.
   */
  now: instantSchema,
  games: z.array(gameSchema),
  /** The caller's own picks for this week — at most three. */
  picks: z.array(pickSchema),
  weekScore: weekScoreSchema,
  seasonPoints: z.int().nonnegative(),
  standings: z.array(standingRowSchema),
  /**
   * True when every week of the season is fully played — the offseason state. The pick
   * page uses it to say "season complete" instead of presenting a board with nothing
   * left to do.
   */
  seasonComplete: z.boolean(),
});

/**
 * Which teams are still spendable in each slot.
 *
 * With a team usable once per slot and so at most three times a season, this is the
 * strategic core of the game — the thing the commissioner keeps a whole hand-written
 * `Selection History` tab for. Derived here, so it cannot drift.
 */
export const teamUsageSchema = z.object({
  season: seasonSchema,
  slots: z.array(
    z.object({
      slot: slotSchema,
      used: z.array(z.object({ teamId: teamCodeSchema, week: weekSchema })),
      remaining: z.array(teamCodeSchema),
    }),
  ),
});

/**
 * Another member's pick, visible only because its game has kicked off.
 *
 * There is no `locked` field because it is always true — the endpoint drops every
 * pick whose game has not started, so an unlockable pick never travels. `source`
 * is absent for the same reason: whose finger tapped the button is not the
 * viewer's business.
 */
export const leaguePickSchema = z.object({
  slot: slotSchema,
  teamId: teamCodeSchema,
  outcome: pickOutcomeSchema,
  points: z.int().nonnegative(),
});

/** One member's row of the League Picks view: everything they hold that is locked. */
export const leaguePickEntrySchema = z.object({
  memberId: idSchema,
  displayName: displayNameSchema,
  isSelf: z.boolean(),
  /** Standings rank, so the list can be read top-down like the standings. */
  rank: z.int().positive(),
  picks: z.array(leaguePickSchema),
});

/**
 * What the league picked this week, one row per member — locked picks only.
 *
 * A member with no locked pick yet is absent from `entries` entirely: the view shows
 * what is visible, not who has or hasn't finished picking.
 */
export const leaguePicksSchema = z.object({
  season: seasonSchema,
  week: weekSchema,
  entries: z.array(leaguePickEntrySchema),
});

export type Season = z.infer<typeof seasonSchema>;
export type Game = z.infer<typeof gameSchema>;
export type Pick = z.infer<typeof pickSchema>;
export type WeekScore = z.infer<typeof weekScoreSchema>;
export type PutPickRequest = z.infer<typeof putPickRequestSchema>;
export type PutPickResponse = z.infer<typeof putPickResponseSchema>;
export type DeletePickResponse = z.infer<typeof deletePickResponseSchema>;
export type StandingRow = z.infer<typeof standingRowSchema>;
export type Standings = z.infer<typeof standingsSchema>;
export type Board = z.infer<typeof boardSchema>;
export type TeamUsage = z.infer<typeof teamUsageSchema>;
export type LeaguePick = z.infer<typeof leaguePickSchema>;
export type LeaguePickEntry = z.infer<typeof leaguePickEntrySchema>;
export type LeaguePicks = z.infer<typeof leaguePicksSchema>;
