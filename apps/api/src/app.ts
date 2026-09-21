import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { Deps } from './deps';
import { MAX_WORKBOOK_BYTES } from './domain/workbooks';
import type { AppEnv } from './http/context';
import { badRequest, errorHandler, notFoundHandler } from './http/errors';
import { originGuard } from './http/middleware';
import { adminRoutes } from './routes/admin';
import { archiveRoutes } from './routes/archive';
import { authRoutes } from './routes/auth';
import { boardRoutes } from './routes/board';
import { healthRoutes } from './routes/health';
import { leagueRoutes } from './routes/leagues';
import { teamRoutes } from './routes/teams';

/** The one request this API accepts that carries a large body: a workbook upload. */
const WORKBOOK_UPLOAD_RE = /^\/leagues\/\d+\/admin\/workbooks$/u;

/** Every other request is a pick or a credential — a few KB at most. */
const JSON_BODY_LIMIT = 64 * 1024;

const oversize = (): never => {
  throw badRequest('request body too large');
};

const jsonLimit = bodyLimit({ maxSize: JSON_BODY_LIMIT, onError: oversize });
const workbookLimit = bodyLimit({ maxSize: MAX_WORKBOOK_BYTES, onError: oversize });

/**
 * Cap request bodies, with one exception.
 *
 * Nothing this API accepts is large — a pick is one team code — except a workbook
 * upload, the one route allowed to carry megabytes. The limit is chosen per route so a
 * JSON endpoint stays capped at 64 KB while the commissioner's workbook fits. The two
 * limits are applied by Hono's own `bodyLimit`, which refuses an oversize body before
 * any handler buffers it.
 */
const bodyLimitFor = createMiddleware<AppEnv>(async (c, next) => {
  const isWorkbookUpload = c.req.method === 'POST' && WORKBOOK_UPLOAD_RE.test(c.req.path);
  await (isWorkbookUpload ? workbookLimit : jsonLimit)(c, next);
});

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
  app.use('*', bodyLimitFor);
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
