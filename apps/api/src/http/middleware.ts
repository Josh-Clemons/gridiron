import { createMiddleware } from 'hono/factory';
import { findSession, readSessionCookie, refreshIfStale, setSessionCookie } from '../auth/sessions';
import type { Deps } from '../deps';
import type { AppEnv } from './context';
import { ApiError, unauthorized } from './errors';

/**
 * Require a valid session, and publish the user it belongs to.
 *
 * Handlers get their identity from `c.get('user')` and nowhere else. In the old Java
 * app the owner of a write came off the request body and the ownership check was
 * inverted *and* dead, so any authenticated user could overwrite anyone's picks.
 */
export function requireAuth(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const token = readSessionCookie(c);
    if (token === undefined) throw unauthorized();

    const session = await findSession(deps, token);
    if (session === undefined) throw unauthorized('session expired');

    c.set('user', session.user);
    c.set('sessionId', session.id);

    const extended = await refreshIfStale(deps, session);
    if (extended !== undefined) setSessionCookie(c, deps.config, token, extended);

    await next();
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Reject cross-site state changes.
 *
 * `SameSite=Lax` already stops the browser attaching the session cookie to a
 * cross-site POST, so this is the second lock on the same door: a request that
 * declares an origin we don't serve is refused before it reaches a handler. Requests
 * with no `Origin` header (curl, the importer, server-to-server) are unaffected.
 */
export function originGuard(deps: Deps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin !== undefined && !deps.config.allowedOrigins.includes(origin)) {
        throw new ApiError('forbidden', 'origin not allowed');
      }
    }
    await next();
  });
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limit, in process memory.
 *
 * Sized for what this actually is — one container, one league of 72 people — and
 * aimed squarely at password guessing and reset-email flooding. It is not a
 * distributed limiter and doesn't pretend to be; if the API ever runs more than one
 * replica this moves to Postgres or Redis.
 */
export function rateLimit(deps: Deps, options: { limit: number; windowMs: number; key: string }) {
  const buckets = new Map<string, Bucket>();

  return createMiddleware<AppEnv>(async (c, next) => {
    if (!deps.config.rateLimitEnabled) {
      await next();
      return;
    }

    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';
    const id = `${options.key}:${ip}`;
    const now = Date.now();

    const bucket = buckets.get(id);
    if (bucket === undefined || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + options.windowMs });
    } else if (bucket.count >= options.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('retry-after', String(retryAfter));
      throw new ApiError('rate_limited', 'too many attempts, try again shortly');
    } else {
      bucket.count += 1;
    }

    // Opportunistic sweep so the map can't grow without bound.
    if (buckets.size > 10_000) {
      for (const [key, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(key);
      }
    }

    await next();
  });
}
