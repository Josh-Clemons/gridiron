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
 * files the operator's CLI does. Throws `ImporterError` when the run failed outright —
 * a drifted layout, an unknown name, a workbook that hangs the parser past its
 * deadline — and kills the subprocess rather than leaving an orphan beside the API.
 * A run that merely found rejections or conflicts succeeds and its findings come back
 * in the report.
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

  const { code, stdout, stderr } = await runCommand('pnpm', args, {
    timeoutMs: IMPORTER_TIMEOUT_MS,
  });

  if (code !== 0) {
    // The whole stderr goes to the log where the operator can read it; only a
    // one-line, human-written message crosses into the HTTP response.
    console.error(`[importer] failed (exit ${String(code)})${stderr === '' ? '' : `\n${stderr}`}`);
    throw new ImporterError(importerFailureMessage(code, stderr));
  }
  return JSON.parse(stdout);
}

/**
 * Run a child process to completion, capturing its output and killing it at a deadline.
 *
 * Without the deadline, a workbook that hangs the parser — a damaged file, a
 * pathologically slow sheet — hangs the HTTP request until the proxy gives up, and
 * leaves an orphaned subprocess running beside the API. Killed outright rather than
 * signalled: the importer is idempotent and its writes are transactional, so a killed
 * run is a safe nonevent.
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number },
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(command, args, { cwd: process.cwd() });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);

  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    throw new ImporterError(
      `the importer did not finish within ${String(Math.round(options.timeoutMs / 1000))} seconds — the workbook may be damaged or too large`,
    );
  }
  return { code, stdout, stderr };
}

/** How long one importer run may take before it is killed. A real run is seconds. */
const IMPORTER_TIMEOUT_MS = 120_000;

/**
 * The importer itself failed — not the workbook's *findings*, which travel in the
 * report, but the run: a drifted layout, an unknown name, a timeout, a crash.
 *
 * Its message is written for the person who uploaded the file, and it is the one
 * error from the import path that reaches the HTTP layer as a 400 rather than a 500.
 */
export class ImporterError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ImporterError';
  }
}

/** A stack frame, as `console.error(error)` prints one. */
const STACK_FRAME = /\n\s+at\s/u;

/**
 * The one-line message for a failed run.
 *
 * The CLI prints a `WorkbookError` as a clean sentence written for the operator, and
 * anything else as a stack trace. The sentence is worth showing the uploader; the
 * stack trace is a crash whose details belong in the log, not in a toast.
 */
export function importerFailureMessage(code: number | null, stderr: string): string {
  const text = stderr.trim();
  if (text === '') return `the importer exited with code ${String(code)}`;
  if (STACK_FRAME.test(text)) return 'the importer failed unexpectedly — see the API log';
  return text.split('\n')[0] ?? 'the importer failed';
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
