import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabase, migrationsFolder, seedReferenceData } from '@gridiron/schema';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * One throwaway Postgres for the whole API test run.
 *
 * Real Postgres, real migrations, real seed — the same three commands a fresh
 * checkout runs. Constraints like the partial unique index that enforces "a team may
 * be used once per slot per season" only exist in the database, so testing against
 * anything else would test a different system.
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
  } finally {
    await sql.end();
  }

  project.provide('databaseUrl', url);

  return async () => {
    await container.stop();
  };
}
