import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { gameStatusEnum, memberRoleEnum, pickSourceEnum, poolEnum, slotEnum } from './enums';

const id = () => bigint({ mode: 'number' }).generatedAlwaysAsIdentity().primaryKey();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/**
 * A season, keyed by the year it starts.
 *
 * `weekCount` is stored rather than assumed: the NFL played 17 weeks through 2020 and
 * 18 from 2021, and the historical workbooks we import include both.
 */
export const seasons = pgTable(
  'seasons',
  {
    id: id(),
    year: integer().notNull(),
    weekCount: integer('week_count').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('seasons_year_key').on(table.year),
    check('seasons_week_count_sane', sql`${table.weekCount} between 1 and 25`),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: id(),
    /** Canonical code. ESPN's spelling, since that's where schedule data comes from. */
    code: text().notNull(),
    name: text().notNull(),
    shortName: text('short_name').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('teams_code_key').on(table.code)],
);

/**
 * Alternate spellings that resolve to a canonical team.
 *
 * The commissioner's spreadsheet writes ARZ, NOR and WAS where ESPN writes ARI, NO and
 * WSH, and the workbook lineage goes back to 2007 so relocated franchises (OAK, SD,
 * STL) turn up in older files. Both ingestion paths resolve through this table rather
 * than hardcoding translations.
 *
 * Aliases are stored already normalised — upper-cased and trimmed — because the
 * spreadsheet contains at least one `"KC "` with trailing whitespace.
 */
export const teamAliases = pgTable(
  'team_aliases',
  {
    id: id(),
    teamId: bigint('team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    alias: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // An alias must resolve to exactly one team, so this is globally unique.
    uniqueIndex('team_aliases_alias_key').on(table.alias),
    index('team_aliases_team_id_idx').on(table.teamId),
    check('team_aliases_alias_normalised', sql`${table.alias} = upper(btrim(${table.alias}))`),
  ],
);

export const games = pgTable(
  'games',
  {
    id: id(),
    seasonId: bigint('season_id', { mode: 'number' })
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    week: integer().notNull(),
    homeTeamId: bigint('home_team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id),
    awayTeamId: bigint('away_team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id),
    kickoff: timestamp({ withTimezone: true }).notNull(),
    status: gameStatusEnum().notNull().default('scheduled'),
    /**
     * Null means either "not decided yet" or "tie" — `status` disambiguates. A tie
     * counts as a loss for both sides (rule 7), so the two cases score identically.
     */
    winnerTeamId: bigint('winner_team_id', { mode: 'number' }).references(() => teams.id),
    /** ESPN event id, so re-syncing updates rather than duplicates. */
    externalId: text('external_id'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('games_season_week_home_key').on(table.seasonId, table.week, table.homeTeamId),
    uniqueIndex('games_external_id_key')
      .on(table.seasonId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    index('games_season_week_idx').on(table.seasonId, table.week),
    check('games_teams_differ', sql`${table.homeTeamId} <> ${table.awayTeamId}`),
    check(
      'games_winner_is_a_participant',
      sql`${table.winnerTeamId} is null
          or ${table.winnerTeamId} = ${table.homeTeamId}
          or ${table.winnerTeamId} = ${table.awayTeamId}`,
    ),
    check(
      'games_winner_only_when_final',
      sql`${table.status} = 'final' or ${table.winnerTeamId} is null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Stored lower-cased; the unique index is on the normalised value. */
    email: text().notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(sql`lower(${table.email})`),
    check('users_email_has_at', sql`position('@' in ${table.email}) > 1`),
  ],
);

/**
 * Server-side sessions.
 *
 * The cookie carries a random secret; only its SHA-256 lives here, so a database dump
 * doesn't hand over live sessions. Deliberately not JWTs — the old app issued
 * 300-day tokens with no way to revoke them.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

export const leagues = pgTable(
  'leagues',
  {
    id: id(),
    name: text().notNull(),
    inviteCode: text('invite_code').notNull(),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('leagues_invite_code_key').on(table.inviteCode)],
);

/**
 * Someone's place in a league — the unit picks actually belong to.
 *
 * `userId` is nullable on purpose. The 72 players in the commissioner's spreadsheet
 * are not app accounts, so the importer creates memberships with a `displayName` and
 * no user behind them. When one of those players registers, setting `userId` claims
 * the membership and they inherit their whole history.
 *
 * Attaching picks here rather than to `users` also means league scope is implied by
 * the foreign key, which simplifies every pick constraint below.
 */
export const leagueMembers = pgTable(
  'league_members',
  {
    id: id(),
    leagueId: bigint('league_id', { mode: 'number' })
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Roster label. For imported players this is the spreadsheet spelling. */
    displayName: text('display_name').notNull(),
    role: memberRoleEnum().notNull().default('member'),
    joinedAt: createdAt(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    // A given user holds at most one membership per league. Placeholder rows have a
    // null userId and are exempt, which is exactly what the partial index gives us.
    uniqueIndex('league_members_league_user_key')
      .on(table.leagueId, table.userId)
      .where(sql`${table.userId} is not null`),
    index('league_members_league_idx').on(table.leagueId),
    index('league_members_user_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

/**
 * One filled slot.
 *
 * A pick only exists when a team is chosen — an unfilled slot is the *absence* of a
 * row, matching how @gridiron/rules models it. That keeps `teamId` NOT NULL, which in
 * turn lets the season-reuse rule be a plain unique index instead of a partial one.
 *
 * There is deliberately no "violations" or "void" column. Invalid picks are rejected
 * at the write path and never stored, and every stored pick is scored from real
 * results with no exceptions.
 */
export const picks = pgTable(
  'picks',
  {
    id: id(),
    leagueMemberId: bigint('league_member_id', { mode: 'number' })
      .notNull()
      .references(() => leagueMembers.id, { onDelete: 'cascade' }),
    seasonId: bigint('season_id', { mode: 'number' })
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    week: integer().notNull(),
    slot: slotEnum().notNull(),
    teamId: bigint('team_id', { mode: 'number' })
      .notNull()
      .references(() => teams.id),
    source: pickSourceEnum().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a pick disappears from a re-imported workbook. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // One pick per slot per week.
    uniqueIndex('picks_member_season_week_slot_key')
      .on(table.leagueMemberId, table.seasonId, table.week, table.slot)
      .where(sql`${table.deletedAt} is null`),

    // Rule 6, enforced by the database: a team may be used only once per slot per
    // season, so at most three times a year. Defense in depth — the rules engine
    // checks this too, but a buggy write path can't get past the index.
    uniqueIndex('picks_member_season_slot_team_key')
      .on(table.leagueMemberId, table.seasonId, table.slot, table.teamId)
      .where(sql`${table.deletedAt} is null`),

    index('picks_member_season_week_idx').on(table.leagueMemberId, table.seasonId, table.week),
    index('picks_season_week_idx').on(table.seasonId, table.week),
    check('picks_week_positive', sql`${table.week} >= 1`),
  ],
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Past champions, imported from the workbook's `Grid Iron Winners` sheet — the
 * regular-season pool from 2007 and the playoff pool from 2012.
 *
 * `memberId` is nullable because a 2009 champion may have no membership row, and
 * `totalPoints` is nullable to represent the 2018 playoff entry, which reads
 * "no game".
 */
export const champions = pgTable(
  'champions',
  {
    id: id(),
    leagueId: bigint('league_id', { mode: 'number' })
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    year: integer().notNull(),
    pool: poolEnum().notNull(),
    memberId: bigint('member_id', { mode: 'number' }).references(() => leagueMembers.id, {
      onDelete: 'set null',
    }),
    displayName: text('display_name').notNull(),
    totalPoints: integer('total_points'),
    note: text(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('champions_league_year_pool_key').on(table.leagueId, table.year, table.pool),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const seasonsRelations = relations(seasons, ({ many }) => ({
  games: many(games),
  picks: many(picks),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  aliases: many(teamAliases),
  picks: many(picks),
}));

export const teamAliasesRelations = relations(teamAliases, ({ one }) => ({
  team: one(teams, { fields: [teamAliases.teamId], references: [teams.id] }),
}));

export const gamesRelations = relations(games, ({ one }) => ({
  season: one(seasons, { fields: [games.seasonId], references: [seasons.id] }),
  homeTeam: one(teams, { fields: [games.homeTeamId], references: [teams.id] }),
  awayTeam: one(teams, { fields: [games.awayTeamId], references: [teams.id] }),
  winner: one(teams, { fields: [games.winnerTeamId], references: [teams.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(leagueMembers),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const leaguesRelations = relations(leagues, ({ many }) => ({
  members: many(leagueMembers),
  champions: many(champions),
}));

export const leagueMembersRelations = relations(leagueMembers, ({ one, many }) => ({
  league: one(leagues, { fields: [leagueMembers.leagueId], references: [leagues.id] }),
  user: one(users, { fields: [leagueMembers.userId], references: [users.id] }),
  picks: many(picks),
}));

export const picksRelations = relations(picks, ({ one }) => ({
  member: one(leagueMembers, {
    fields: [picks.leagueMemberId],
    references: [leagueMembers.id],
  }),
  season: one(seasons, { fields: [picks.seasonId], references: [seasons.id] }),
  team: one(teams, { fields: [picks.teamId], references: [teams.id] }),
}));

export const championsRelations = relations(champions, ({ one }) => ({
  league: one(leagues, { fields: [champions.leagueId], references: [leagues.id] }),
  member: one(leagueMembers, { fields: [champions.memberId], references: [leagueMembers.id] }),
}));
