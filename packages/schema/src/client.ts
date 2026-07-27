import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './tables';

export type Database = ReturnType<typeof createDatabase>;

let envLoaded = false;

/**
 * Load the repo-root `.env` for local scripts.
 *
 * Best-effort by design: in Docker and CI the variable is supplied directly and no
 * `.env` exists, which is not an error. An already-set `DATABASE_URL` always wins, so
 * the file can never override a deliberately configured environment.
 */
function loadEnvOnce(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env['DATABASE_URL'] !== undefined) return;

  let dir = import.meta.dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function databaseUrl(): string {
  loadEnvOnce();
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env');
  }
  return url;
}

/**
 * Build a Drizzle client.
 *
 * `max: 1` suits one-shot scripts (migrate, seed) where a pool would keep the process
 * alive; the API passes a larger value.
 */
export function createDatabase(url: string = databaseUrl(), options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  // `casing` must match drizzle.config.ts. That setting governs how migrations are
  // generated; without it here the runtime client would look for "createdAt" where
  // the DDL created "created_at".
  return { db: drizzle(sql, { schema, casing: 'snake_case' }), sql };
}
