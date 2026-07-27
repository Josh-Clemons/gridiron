import { createDatabase } from '../client';
import { seedReferenceData } from './seed';

/** CLI wrapper around `seedReferenceData` — `pnpm db:seed`. */
const { db, sql } = createDatabase(undefined, { max: 1 });

try {
  const counts = await seedReferenceData(db);
  console.log(
    `seeded ${String(counts.seasons)} seasons, ${String(counts.teams)} teams, ${String(counts.aliases)} aliases`,
  );
} finally {
  await sql.end();
}
