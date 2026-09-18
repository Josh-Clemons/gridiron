import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDatabase } from '@gridiron/schema';
import { upsertChampions } from './data/champions';
import { createDeps } from './data/deps';
import { requireLeague } from './data/league';
import { runImport } from './import';
import { Roster } from './parse/roster';
import { readWorkbook, WorkbookError } from './parse/workbook';
import { parseWinners, WINNERS_SHEET } from './parse/winners';
import { renderReport } from './report';

/**
 * The importer, as a command.
 *
 * Dry-run by default, which is the mode used most weeks: run it, read the report, run
 * it again with `--apply`. Every stage before the write is identical between the two,
 * so the report is never a guess about what `--apply` would do.
 *
 *   pnpm importer --file "Grid Iron- 2026.xlsx" --league 1 --season 2026
 *   pnpm importer --file "Grid Iron- 2026.xlsx" --league 1 --season 2026 --apply
 *   pnpm importer --file "Grid Iron- 2025.xlsx" --league 1 --winners
 */
const USAGE = `usage: importer --file <workbook> --league <id> [--season YYYY] [--apply] [--winners] [--json]

  --file     the commissioner's workbook, .xlsx or legacy .xls
  --league   the league id to import into
  --season   the season year; required unless --winners
  --apply    write the surviving picks. Without it nothing is written.
  --winners  one-shot: load the "${WINNERS_SHEET}" sheet instead of picks.
             Run it against the newest workbook — later files correct earlier ones.
  --json     print the ImportResult as JSON instead of the human report. A run
             with findings still exits 0, because the findings are the answer.

Exits non-zero when anything was rejected or conflicted, so a scripted run that ends
up partial is noticed rather than passing quietly.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      league: { type: 'string' },
      season: { type: 'string' },
      apply: { type: 'boolean', default: false },
      winners: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || values.file === undefined) {
    console.log(USAGE);
    return;
  }

  const leagueId = requireInteger(values.league, '--league');
  const { db, sql } = createDatabase(undefined, { max: 1 });
  const deps = createDeps({ db });

  try {
    if (values.winners) {
      await runWinners(deps, leagueId, resolveFile(values.file), values.apply);
      return;
    }

    const year = requireInteger(values.season, '--season');
    const result = await runImport(deps, {
      file: resolveFile(values.file),
      leagueId,
      year,
      apply: values.apply,
    });

    if (values.json) {
      // The report is the product; a run that found rejections or conflicts is a
      // successful run, so it exits 0 and lets the caller judge the findings.
      console.log(JSON.stringify(result));
    } else {
      console.log(renderReport(result));

      // Non-zero on anything a human still has to deal with. A rejected pick means a
      // player is scoring 0 for a slot they meant to fill, and a conflict means two
      // sources disagree — neither should slip past a cron job unnoticed.
      if (result.rejections.length > 0 || result.conflicts.length > 0) process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

async function runWinners(
  deps: ReturnType<typeof createDeps>,
  leagueId: number,
  file: string,
  apply: boolean,
): Promise<void> {
  const league = await requireLeague(deps, leagueId);
  const workbook = readWorkbook(file);
  if (!workbook.has(WINNERS_SHEET)) {
    throw new WorkbookError(
      `${file} has no "${WINNERS_SHEET}" sheet — the 2020 workbook is one of the files that omits it`,
    );
  }

  const winners = parseWinners(workbook);
  const outcomes = await upsertChampions(deps, leagueId, winners.champions, Roster.load(), apply);

  console.log(`${file}\n  ${league.name} · ${String(outcomes.length)} champion(s)\n`);
  for (const outcome of outcomes) {
    const points = outcome.totalPoints === null ? '—' : String(outcome.totalPoints);
    console.log(
      `  ${String(outcome.year)} ${outcome.pool.padEnd(7)} ${outcome.displayName.padEnd(24)} ${points.padStart(4)}` +
        `${outcome.linked ? '  (member)' : ''}  ${outcome.action}`,
    );
  }

  if (winners.vacant.length > 0) {
    console.log(`\n  ${String(winners.vacant.length)} year(s) with no champion recorded:`);
    for (const vacant of winners.vacant) {
      console.log(`    ${String(vacant.year)} ${vacant.pool} — ${vacant.reason}`);
    }
  }

  console.log(apply ? '\napplied.' : '\ndry run. Nothing was written. Re-run with --apply.');
}

/**
 * Resolve `--file` against the directory the operator actually typed the command in.
 *
 * `pnpm importer` runs the script with its cwd set to `apps/importer`, so a path that
 * looks right from the repo root — where you are when you run it — would otherwise fail
 * with ENOENT on a file that is plainly there. pnpm records the real directory in
 * `INIT_CWD`; falling back to `process.cwd()` keeps a direct `tsx src/cli.ts` working.
 */
function resolveFile(file: string): string {
  if (isAbsolute(file)) return file;
  return resolve(process.env['INIT_CWD'] ?? process.cwd(), file);
}

function requireInteger(raw: string | undefined, flag: string): number {
  if (raw === undefined) throw new Error(`${flag} is required\n\n${USAGE}`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}

try {
  await main();
} catch (error) {
  // A WorkbookError is an expected outcome — a drifted layout, an unknown name — and
  // its message is written for the operator, so it prints without a stack trace.
  if (error instanceof WorkbookError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
