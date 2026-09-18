import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Deps } from './deps';
import type { AppEnv } from './http/context';
import { errorHandler, notFoundHandler } from './http/errors';
import { originGuard } from './http/middleware';
import { adminRoutes } from './routes/admin';
import { archiveRoutes } from './routes/archive';
import { authRoutes } from './routes/auth';
import { boardRoutes } from './routes/board';
import { healthRoutes } from './routes/health';
import { leagueRoutes } from './routes/leagues';
import { teamRoutes } from './routes/teams';

/**
 * Build the API.
 *
 * Everything external arrives through `deps`, so a test can hand it a throwaway
 * database, a fixed clock and an in-memory mailer and exercise the real routes rather
 * than a mock of them.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.use('*', secureHeaders());
  // Nothing this API accepts is large. A pick is one team code.
  app.use('*', bodyLimit({ maxSize: 64 * 1024 }));
  app.use(
    '*',
    cors({
      origin: [...deps.config.allowedOrigins],
      // The session lives in a cookie, so the browser must be allowed to send it.
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type'],
    }),
  );
  app.use('*', originGuard(deps));

  app.route('/', healthRoutes(deps));
  app.route('/', teamRoutes(deps));
  app.route('/', authRoutes(deps));
  app.route('/', leagueRoutes(deps));
  app.route('/', boardRoutes(deps));
  app.route('/', archiveRoutes(deps));
  app.route('/', adminRoutes(deps));

  return app;
}

export type App = ReturnType<typeof createApp>;
