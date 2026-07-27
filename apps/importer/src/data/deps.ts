import type { Database } from '@gridiron/schema';
import { TeamCatalog } from './teams';

export type Db = Database['db'];

/**
 * A database handle that may be the pool or an open transaction.
 *
 * Stage 3 runs every write inside one transaction so a failure half-way leaves nothing
 * behind, while the read-only stages use the pool directly.
 */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * What the importer needs from the outside world.
 *
 * Much smaller than the API's equivalent — no mailer, no config, no HTTP — because the
 * importer is a one-shot process. The clock is still injected: golden tests replay
 * seasons that finished years ago, and validation asks whether games have kicked off.
 */
export interface Deps {
  readonly db: Db;
  readonly now: () => Date;
  /** Memoised: teams and aliases are seed data and don't change while the process runs. */
  readonly teams: () => Promise<TeamCatalog>;
}

export interface CreateDepsInput {
  readonly db: Db;
  readonly now?: () => Date;
}

export function createDeps(input: CreateDepsInput): Deps {
  let catalog: Promise<TeamCatalog> | undefined;
  return {
    db: input.db,
    now: input.now ?? ((): Date => new Date()),
    teams: (): Promise<TeamCatalog> => {
      catalog ??= TeamCatalog.load(input.db);
      return catalog;
    },
  };
}
