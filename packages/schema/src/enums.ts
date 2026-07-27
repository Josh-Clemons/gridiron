import { pgEnum } from 'drizzle-orm/pg-core';

/** Matches `Slot` in @gridiron/rules. Win 5, Place 3, Show 1. */
export const slotEnum = pgEnum('slot', ['win', 'place', 'show']);

export const gameStatusEnum = pgEnum('game_status', ['scheduled', 'final']);

/**
 * Where a pick came from.
 *
 * Both paths run the same validation; this exists for provenance and so the importer
 * can detect that a slot already holds a pick the player entered themselves.
 */
export const pickSourceEnum = pgEnum('pick_source', ['app', 'import']);

export const memberRoleEnum = pgEnum('member_role', ['owner', 'member']);

/** The regular-season pool and the separate playoff pool that has run since 2012. */
export const poolEnum = pgEnum('pool', ['regular', 'playoff']);
