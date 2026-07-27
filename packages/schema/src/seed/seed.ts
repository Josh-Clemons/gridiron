/* eslint-disable no-await-in-loop --
 * The upserts below are deliberately sequential. They run inside one transaction
 * against ~36 rows of reference data, where ordering is clearer than concurrency and
 * a team must exist before its aliases can reference it.
 */
import type { Database } from '../client';
import { seasons, teamAliases, teams } from '../tables';
import { SEASONS } from './seasons';
import { normaliseAlias, TEAMS } from './teams';

export interface SeedCounts {
  readonly seasons: number;
  readonly teams: number;
  readonly aliases: number;
}

/**
 * Idempotent seed of reference data: the 32 teams, their alias spellings, and the
 * seasons we know about.
 *
 * Safe to re-run — every write is an upsert. Nothing here is user data.
 *
 * Exported as a function, not just a script, so the API's integration tests build
 * their throwaway database exactly the way `pnpm db:seed` builds a real one. A test
 * fixture that drifts from the real seed is a test that proves nothing.
 *
 * The old Java app's signup was broken on any fresh database because its `roles` table
 * was populated by hand and no seed existed. This app has no roles table at all
 * (membership role is an enum column), and everything else it needs is created here.
 */
export async function seedReferenceData(db: Database['db']): Promise<SeedCounts> {
  await db.transaction(async (tx) => {
    for (const season of SEASONS) {
      await tx
        .insert(seasons)
        .values({ year: season.year, weekCount: season.weekCount })
        .onConflictDoUpdate({
          target: seasons.year,
          set: { weekCount: season.weekCount },
        });
    }

    for (const team of TEAMS) {
      const [row] = await tx
        .insert(teams)
        .values({ code: team.code, name: team.name, shortName: team.shortName })
        .onConflictDoUpdate({
          target: teams.code,
          set: { name: team.name, shortName: team.shortName },
        })
        .returning({ id: teams.id });

      if (row === undefined) {
        throw new Error(`failed to upsert team ${team.code}`);
      }

      // The canonical code is an alias too, so every lookup goes through one path.
      const aliases = [
        ...new Set([team.code, ...team.aliases].map((alias) => normaliseAlias(alias))),
      ];
      for (const alias of aliases) {
        await tx
          .insert(teamAliases)
          .values({ teamId: row.id, alias })
          .onConflictDoNothing({ target: teamAliases.alias });
      }
    }
  });

  const aliasCount = TEAMS.reduce(
    (total, team) =>
      total + new Set([team.code, ...team.aliases].map((alias) => normaliseAlias(alias))).size,
    0,
  );

  return { seasons: SEASONS.length, teams: TEAMS.length, aliases: aliasCount };
}
