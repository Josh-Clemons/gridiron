import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDatabase,
  games,
  migrationsFolder,
  seasons,
  seedReferenceData,
  teams,
} from '@gridiron/schema';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    importerDatabaseUrl: string;
  }
}

interface GameFixture {
  readonly year: number;
  readonly week: number;
  readonly home: string;
  readonly away: string;
  readonly kickoff: string;
  readonly status: 'scheduled' | 'final';
  readonly winner: string | null;
}

/**
 * One throwaway Postgres for the importer test run, preloaded with three real seasons.
 *
 * The golden tests validate 2020, 2023 and 2025 picks against the schedules and results
 * those seasons actually had — a pick for a team on a bye has to be rejected, and a
 * scoring disagreement is only meaningful against real winners. `games.json` is a dump
 * of the ESPN data the sync already fetched, so the tests need neither the network nor
 * a developer's local database.
 */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('gridiron')
    .withUsername('gridiron')
    .withPassword('gridiron')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();

  const url = container.getConnectionUri();
  const { db, sql } = createDatabase(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    await seedReferenceData(db);
    await loadGames(db);
  } finally {
    await sql.end();
  }

  project.provide('importerDatabaseUrl', url);

  return async () => {
    await container.stop();
  };
}

/** Look up a reference row, loudly. A miss means the fixture and the seed disagree. */
function lookUp<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`games.json references an unknown ${what}: ${String(key)}`);
  }
  return value;
}

async function loadGames(db: ReturnType<typeof createDatabase>['db']): Promise<void> {
  const path = join(import.meta.dirname, 'fixtures', 'games.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('games.json is not an array');
  const fixtures: readonly GameFixture[] = parsed;

  const teamRows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamId = new Map(teamRows.map((row) => [row.code, row.id]));
  const seasonRows = await db.select({ id: seasons.id, year: seasons.year }).from(seasons);
  const seasonId = new Map(seasonRows.map((row) => [row.year, row.id]));

  await db.insert(games).values(
    fixtures.map((fixture) => ({
      seasonId: lookUp(seasonId, fixture.year, 'season'),
      week: fixture.week,
      homeTeamId: lookUp(teamId, fixture.home, 'team'),
      awayTeamId: lookUp(teamId, fixture.away, 'team'),
      kickoff: new Date(fixture.kickoff),
      status: fixture.status,
      winnerTeamId: fixture.winner === null ? null : lookUp(teamId, fixture.winner, 'team'),
    })),
  );
}
