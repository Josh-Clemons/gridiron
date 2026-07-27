import { z } from 'zod';

/**
 * A database row id.
 *
 * The schema uses `bigint generated always as identity` but reads it back as a JS
 * number, which is safe well past any row count this app will ever see.
 */
export const idSchema = z.int().positive();

/** Win 5 / Place 3 / Show 1 — the pool's own vocabulary since 2007. */
export const slotSchema = z.enum(['win', 'place', 'show']);

/**
 * Regular-season week. The upper bound is deliberately loose (the NFL played 17
 * weeks through 2020 and 18 from 2021); the real bound is the season's `weekCount`,
 * which only the server knows.
 */
export const weekSchema = z.int().min(1).max(25);

export const seasonYearSchema = z.int().min(2007).max(2100);

/**
 * Canonical team code, e.g. `KC`. The API speaks codes rather than row ids: they are
 * stable, human-readable in logs, and what `@gridiron/rules` already uses as its
 * `TeamId`. Spreadsheet and ESPN spellings resolve to these through `team_aliases`.
 */
export const teamCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,3}$/u, 'not a team code');

/** Wire format for timestamps, always UTC ISO-8601. */
export const instantSchema = z.iso.datetime();

export const gameStatusSchema = z.enum(['scheduled', 'final']);

export const pickSourceSchema = z.enum(['app', 'import']);

export const memberRoleSchema = z.enum(['owner', 'member']);

export type Id = z.infer<typeof idSchema>;
export type Slot = z.infer<typeof slotSchema>;
export type TeamCode = z.infer<typeof teamCodeSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type PickSource = z.infer<typeof pickSourceSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
