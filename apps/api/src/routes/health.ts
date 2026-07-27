import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Deps } from '../deps';
import type { AppEnv } from '../http/context';

/**
 * Liveness for the container healthcheck and `status-check.sh`.
 *
 * It touches the database on purpose: an API that answers 200 while Postgres is down
 * is exactly the kind of green light that hides an outage.
 */
export function healthRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get('/health', async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
    } catch (error) {
      console.error('health check failed', error);
      return c.json({ status: 'degraded', database: false }, 503);
    }
    return c.json({ status: 'ok', database: true, now: deps.now().toISOString() });
  });

  return app;
}
