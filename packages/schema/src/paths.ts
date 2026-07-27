import { join } from 'node:path';

/**
 * Where the generated SQL migrations live.
 *
 * Exported so anything that needs a schema — the migrate script, the API's
 * integration tests — points at the same directory instead of rebuilding the relative
 * path and quietly diverging.
 */
export const migrationsFolder = join(import.meta.dirname, '..', 'migrations');
