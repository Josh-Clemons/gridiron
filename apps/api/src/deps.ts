import type { Database } from '@gridiron/schema';
import type { Config } from './config';
import { TeamCatalog } from './data/teams';
import type { Mailer } from './mail/mailer';

export type Db = Database['db'];

/**
 * Everything the routes need from the outside world, passed in rather than imported.
 *
 * The clock in particular is injected: pick locking is entirely a question of "is it
 * past kickoff", and a test that can't move time can't check the boundary. The old app
 * called `new Date()` inline during render, which is exactly what made its locking
 * untestable.
 */
export interface Deps {
  readonly db: Db;
  readonly config: Config;
  readonly mailer: Mailer;
  readonly now: () => Date;
  /** Memoised: teams and aliases are seed data and don't change while the process runs. */
  readonly teams: () => Promise<TeamCatalog>;
}

export interface CreateDepsInput {
  readonly db: Db;
  readonly config: Config;
  readonly mailer: Mailer;
  readonly now?: () => Date;
}

export function createDeps(input: CreateDepsInput): Deps {
  let catalog: Promise<TeamCatalog> | undefined;
  return {
    db: input.db,
    config: input.config,
    mailer: input.mailer,
    now: input.now ?? ((): Date => new Date()),
    teams: (): Promise<TeamCatalog> => {
      catalog ??= TeamCatalog.load(input.db);
      return catalog;
    },
  };
}
