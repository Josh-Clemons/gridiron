import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { passwordResetTokens, sessions, users } from '@gridiron/schema';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Config } from '../config';
import type { Deps } from '../deps';

export const SESSION_COOKIE = 'gridiron_session';

export interface SessionUser {
  readonly id: number;
  readonly email: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly createdAt: Date;
}

export interface ActiveSession {
  readonly id: number;
  readonly expiresAt: Date;
  readonly user: SessionUser;
}

/**
 * Sessions are opaque random tokens, stored hashed.
 *
 * Only the SHA-256 of the token lives in the database, so a leaked dump hands over no
 * usable sessions, and revocation is a `DELETE` — neither of which is true of the
 * signed 300-day JWT the old app put in a JS-readable cookie. SHA-256 rather than
 * Argon2 because the input is 256 bits of entropy, not a guessable password.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  deps: Deps,
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(deps.now().getTime() + deps.config.sessionTtlMs);
  // `createdAt` is passed rather than left to the column default: `defaultNow()` is
  // Postgres' clock, and every other instant on this row comes from `deps.now()`. Under
  // CLOCK_OVERRIDE the two disagree by months, which stamps rows that expire long before
  // they were created.
  await deps.db
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt, createdAt: deps.now() });
  return { token, expiresAt };
}

export async function findSession(deps: Deps, token: string): Promise<ActiveSession | undefined> {
  const rows = await deps.db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return undefined;

  if (row.expiresAt.getTime() <= deps.now().getTime()) {
    await deps.db.delete(sessions).where(eq(sessions.id, row.id));
    return undefined;
  }

  return {
    id: row.id,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      isAdmin: row.isAdmin,
      createdAt: row.createdAt,
    },
  };
}

export async function revokeSession(deps: Deps, sessionId: number): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Every session for a user — used after a password reset. */
export async function revokeAllSessions(deps: Deps, userId: number): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Every session *except* the caller's own — used when a password is changed from an
 * authenticated session. The changer keeps their seat; anyone else logged in as them
 * is dropped.
 */
export async function revokeOtherSessions(
  deps: Deps,
  userId: number,
  keepSessionId: number,
): Promise<void> {
  await deps.db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

/** Housekeeping for expired rows; cheap enough to run opportunistically at login. */
export async function purgeExpiredSessions(deps: Deps): Promise<void> {
  await deps.db.delete(sessions).where(lt(sessions.expiresAt, deps.now()));
}

/**
 * The same housekeeping for reset tokens, run when one is issued.
 *
 * Only *unredeemed* expired tokens go. A redeemed row is the one durable record that a
 * password changed and when — `users.updated_at` holds just the latest change, and the
 * account has no other audit trail — so it is kept deliberately rather than swept an
 * hour after use. That leaves the abandoned requests, which are the bulk of the table,
 * and keeps growth to a handful of rows per account per year.
 */
export async function purgeExpiredResetTokens(deps: Deps): Promise<void> {
  await deps.db
    .delete(passwordResetTokens)
    .where(and(lt(passwordResetTokens.expiresAt, deps.now()), isNull(passwordResetTokens.usedAt)));
}

/**
 * Extend a session that is more than halfway through its life.
 *
 * Sliding expiry means an active player never gets logged out mid-season, while the
 * halfway threshold keeps this from writing a row on every single request.
 */
export async function refreshIfStale(
  deps: Deps,
  session: ActiveSession,
): Promise<Date | undefined> {
  const remaining = session.expiresAt.getTime() - deps.now().getTime();
  if (remaining > deps.config.sessionTtlMs / 2) return undefined;

  const expiresAt = new Date(deps.now().getTime() + deps.config.sessionTtlMs);
  await deps.db.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.id));
  return expiresAt;
}

/**
 * `Max-Age`, not `Expires`.
 *
 * A duration is measured against the *browser's* clock, an absolute instant against
 * ours. They are the same thing only when the two clocks agree, and the row in
 * `sessions` is the real authority either way — the cookie just has to survive as long
 * as the session does. A device whose clock is days off would otherwise arrive holding
 * a cookie it thinks expired, and `CLOCK_OVERRIDE` breaks it outright: the server
 * stamps a date months in the browser's past and every request arrives signed out.
 */
export function setSessionCookie(c: Context, config: Config, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSessionCookie(c: Context, config: Config): void {
  deleteCookie(c, SESSION_COOKIE, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
  });
}

export function readSessionCookie(c: Context): string | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  return token === undefined || token === '' ? undefined : token;
}

/**
 * Constant-time string comparison, for the few places a secret is compared directly.
 */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
