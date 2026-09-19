import { createDatabase } from '@gridiron/schema';
import { createAlerter } from '../alerts/alerter';
import { loadConfig } from '../config';
import { createDeps } from '../deps';
import { runReminders } from '../domain/reminders';
import { mailerFor } from '../mail/mailer';

/**
 * The pick reminder, as a command.
 *
 * Cron runs it every quarter hour through the game-day windows, and you can run it by
 * hand with the same command — there is no separate manual path. It is idempotent and
 * deduplicated: outside the 15-minute lead before the next kickoff it sends nothing,
 * and a member who was already reminded this week never gets a second email.
 *
 *   pnpm reminder
 *
 * Exits non-zero on any failure, so a cron run that breaks alerts rather than quietly
 * sending nobody anything.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sql } = createDatabase(config.databaseUrl, { max: 1 });
  const deps = createDeps({
    db,
    config,
    // Built from the whole config, not a hand-picked transport — see the same note in
    // sync/cli.ts, where forgetting the credentials once killed every scheduled run.
    mailer: mailerFor(config),
  });
  const alerter = createAlerter(config);

  try {
    const result = await runReminders(deps);
    console.log(
      result.notYet
        ? 'reminder: not yet — no kickoff within 15 minutes'
        : `reminder: sent ${String(result.sent)}`,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await alerter.send({ subject: 'gridiron reminder failed', detail });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

await main();
