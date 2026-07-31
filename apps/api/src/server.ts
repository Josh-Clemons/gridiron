import { serve } from '@hono/node-server';
import { createDatabase } from '@gridiron/schema';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';
import { mailerFor } from './mail/mailer';

/**
 * Process entry point.
 *
 * Binds to 127.0.0.1 unless `HOST` says otherwise. Anything on a non-localhost
 * address here would be reachable from every tailnet peer; public access comes from
 * Caddy on the same box, which is the rule the rest of the machine's services follow.
 * In production the process runs in a container, where the same rule is enforced by
 * Docker publishing the port to `127.0.0.1` on the host — see `HOST` in `config.ts`.
 */
const config = loadConfig();
const { db, sql } = createDatabase(config.databaseUrl, { max: 10 });

/**
 * The simulated clock, when one is configured. Every lock decision, every score and
 * the live-week calculation read `deps.now()`, so this one line moves the whole app
 * to another moment in history.
 */
const clock = (): Date => new Date(Date.now() + config.clockOffsetMs);
if (config.clockOffsetMs !== 0) {
  console.warn(`CLOCK OVERRIDE ACTIVE — the server believes it is ${clock().toISOString()}`);
}

const deps = createDeps({
  db,
  config,
  mailer: mailerFor(config),
  ...(config.clockOffsetMs === 0 ? {} : { now: clock }),
});

const server = serve(
  { fetch: createApp(deps).fetch, port: config.port, hostname: config.host },
  () => {
    console.info(
      `gridiron api listening on ${config.host}:${String(config.port)} (${config.nodeEnv})`,
    );
  },
);

/** Stop accepting connections, then let the pool drain, so a redeploy loses nothing. */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void sql.end().then(() => {
        process.exit(0);
      });
    });
  });
}
