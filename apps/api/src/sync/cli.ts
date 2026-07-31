import { parseArgs } from 'node:util';
import { createDatabase } from '@gridiron/schema';
import { createAlerter } from '../alerts/alerter';
import { loadConfig } from '../config';
import { currentWeek, resolveSeason } from '../data/seasons';
import { createDeps } from '../deps';
import { mailerFor } from '../mail/mailer';
import { createEspnClient } from './espn';
import { requireSeason, type SeasonSyncResult, syncSeason, syncWeeks } from './games';

/**
 * The sync, as a command.
 *
 * Cron runs it on a schedule and you run it by hand with the same arguments — there is
 * no separate "manual" path that could behave differently from the automated one. Every
 * run is idempotent, so re-running after a failure is always the right move.
 *
 *   pnpm sync schedule                 # every week of the current season
 *   pnpm sync schedule --season 2020   # backfill a past season, results included
 *   pnpm sync results                  # the live week and the one before it
 *   pnpm sync results --week 7
 *
 * Exits non-zero on any failure so a cron run that breaks is noticed rather than
 * quietly partial.
 */
const USAGE = `usage: sync <schedule|results> [--season YYYY] [--week N]

  schedule   every week of the season — also how a finished season is backfilled
  results    the earliest unfinished week plus the previous one, to catch late finals
  --season   defaults to the newest season in the database
  --week     sync exactly this week`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      season: { type: 'string' },
      week: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return;
  }
  if (command !== 'schedule' && command !== 'results') {
    throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }

  const config = loadConfig();
  const { db, sql } = createDatabase(config.databaseUrl, { max: 1 });
  const deps = createDeps({
    db,
    config,
    // The sync sends no mail, but `createDeps` needs a mailer. Built from the whole
    // config rather than a hand-picked transport: passing the transport alone
    // type-checks and then throws under MAIL_TRANSPORT=resend, so every production
    // run of this CLI used to die here before it reached ESPN.
    mailer: mailerFor(config),
  });
  const alerter = createAlerter(config);
  const client = createEspnClient({
    ...(config.espnBaseUrl === undefined ? {} : { baseUrl: config.espnBaseUrl }),
    timeoutMs: config.espnTimeoutMs,
  });

  try {
    const year =
      values.season === undefined ? (await resolveSeason(deps)).year : Number(values.season);
    const season = await requireSeason(deps, year);
    const week = values.week === undefined ? undefined : Number(values.week);

    if (week !== undefined && (week < 1 || week > season.weekCount)) {
      throw new Error(`season ${String(year)} has weeks 1..${String(season.weekCount)}`);
    }

    const started = Date.now();
    let result: SeasonSyncResult;

    if (week !== undefined) {
      result = await syncWeeks(deps, client, year, [week]);
    } else if (command === 'schedule') {
      result = await syncSeason(deps, client, year);
    } else {
      // Results: the live week, plus the one before it. A Monday-night game finalises
      // after the next week has technically begun, and a corrected score can land days
      // later; re-syncing the previous week costs one request and catches both.
      const live = await currentWeek(deps, season);
      const weeks = live > 1 ? [live - 1, live] : [live];
      result = await syncWeeks(deps, client, year, weeks);
    }

    report(command, result, Date.now() - started);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await alerter.send({
      subject: `gridiron ${command} sync failed`,
      detail,
    });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

function report(command: string, result: SeasonSyncResult, elapsedMs: number): void {
  for (const week of result.weeks) {
    console.log(
      `week ${String(week.week).padStart(2, ' ')}: ${String(week.fetched)} games — ` +
        `${String(week.inserted)} new, ${String(week.updated)} updated, ${String(week.unchanged)} unchanged` +
        (week.orphaned > 0 ? `, ${String(week.orphaned)} NOT IN ESPN'S LIST` : ''),
    );
  }
  console.log(
    `${command} ${String(result.year)}: ${String(result.inserted)} new, ` +
      `${String(result.updated)} updated, ${String(result.unchanged)} unchanged in ${String(Math.round(elapsedMs / 100) / 10)}s`,
  );
  if (result.orphaned > 0) {
    // Not fatal, but somebody needs to look: a game we hold vanished from the source.
    console.warn(
      `${String(result.orphaned)} stored game(s) were not in ESPN's response — postponed, relocated, or re-keyed. Nothing was deleted.`,
    );
  }
}

await main();
