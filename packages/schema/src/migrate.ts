import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

const migrationsFolder = join(import.meta.dirname, '..', 'migrations');

const { db, sql } = createDatabase(undefined, { max: 1 });

try {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
} finally {
  await sql.end();
}
