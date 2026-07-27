import { serve } from '@hono/node-server';
import { createDatabase } from '@gridiron/schema';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';
import { createMailer } from './mail/mailer';

/**
 * Process entry point.
 *
 * Binds to 127.0.0.1 only. Anything on a non-localhost address here would be
 * reachable from every tailnet peer; public access comes from Caddy on the same box,
 * which is the rule the rest of the machine's services follow.
 */
const config = loadConfig();
const { db, sql } = createDatabase(config.databaseUrl, { max: 10 });
const deps = createDeps({ db, config, mailer: createMailer(config.mailTransport) });

const server = serve(
  { fetch: createApp(deps).fetch, port: config.port, hostname: '127.0.0.1' },
  () => {
    console.info(`gridiron api listening on 127.0.0.1:${String(config.port)} (${config.nodeEnv})`);
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
