import type { Database } from '@gridiron/schema';
import { spawn } from 'node:child_process';
import type { Config } from './config';
import { TeamCatalog } from './data/teams';
import type { Mailer } from './mail/mailer';

export type Db = Database['db'];

/** One run of the importer against a stored workbook. */
export interface ImportJob {
  readonly file: string;
  readonly leagueId: number;
  readonly year: number;
  readonly apply: boolean;
}

/**
 * Run the importer CLI as a subprocess and return its JSON report.
 *
 * The importer is a separate app, and this is the seam that keeps it the single source
 * of truth for parsing and reconciliation: the API shells out rather than re-implement
 * any of it. The image bundles both apps, so `tsx ../importer/src/cli.ts` runs the same
 * files the operator's CLI does. Throws when the run failed outright (a drifted layout,
 * an unknown name) — a run that merely found rejections or conflicts succeeds and its
 * findings come back in the report.
 */
export async function runImporterCli(job: ImportJob): Promise<unknown> {
  const args = [
    'exec',
    'tsx',
    '../importer/src/cli.ts',
    '--file',
    job.file,
    '--league',
    String(job.leagueId),
    '--season',
    String(job.year),
    '--json',
    ...(job.apply ? ['--apply'] : []),
  ];

  const child = spawn('pnpm', args, { cwd: process.cwd() });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  if (code !== 0) {
    throw new Error(stderr.trim() === '' ? `importer exited ${String(code)}` : stderr.trim());
  }
  return JSON.parse(stdout);
}

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
  /** Runs the importer against a stored workbook; injectable so tests can fake it. */
  readonly runImporter: (job: ImportJob) => Promise<unknown>;
}

export interface CreateDepsInput {
  readonly db: Db;
  readonly config: Config;
  readonly mailer: Mailer;
  readonly now?: () => Date;
  readonly runImporter?: (job: ImportJob) => Promise<unknown>;
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
    runImporter: input.runImporter ?? runImporterCli,
  };
}
