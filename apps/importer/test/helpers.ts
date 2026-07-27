import { join } from 'node:path';
import { createDatabase, leagues } from '@gridiron/schema';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { createDeps, type Db, type Deps } from '../src/data/deps';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

/** The workbook for a year, as committed. */
export function workbook(year: 2020 | 2023 | 2025): string {
  return join(FIXTURES, year === 2025 ? 'Grid Iron- 2025.xlsx' : `Grid Iron- ${String(year)}.xls`);
}

export interface Harness {
  readonly deps: Deps;
  readonly db: Db;
  /** Move the injected clock. */
  setNow(when: Date): void;
  /** Empty every table the importer writes and return a fresh league's id. */
  reset(): Promise<number>;
  close(): Promise<void>;
}

/** Tables the importer writes. Reference data — teams, seasons, games — survives. */
const MUTABLE_TABLES = ['picks', 'champions', 'league_members', 'leagues'];

/**
 * A database and a fresh empty league.
 *
 * The clock defaults to well after every season in the fixtures, so nothing is in the
 * future. The importer ignores the kickoff lock anyway, but a test that turns that off
 * needs a clock it can trust.
 */
export async function createHarness(now = new Date('2026-01-01T00:00:00Z')): Promise<Harness> {
  const databaseUrl = inject('importerDatabaseUrl');
  const { db, sql: client } = createDatabase(databaseUrl, { max: 5 });

  let clock = now;
  const deps = createDeps({ db, now: () => clock });

  const harness: Harness = {
    deps,
    db,
    setNow(when: Date): void {
      clock = when;
    },
    async reset(): Promise<number> {
      await db.execute(
        sql.raw(`truncate table ${MUTABLE_TABLES.join(', ')} restart identity cascade`),
      );
      clock = now;
      const [league] = await db
        .insert(leagues)
        .values({ name: 'Grid Iron', inviteCode: `CODE${String(Date.now()).slice(-4)}` })
        .returning({ id: leagues.id });
      if (league === undefined) throw new Error('could not create the test league');
      return league.id;
    },
    async close(): Promise<void> {
      await client.end();
    },
  };

  return harness;
}
