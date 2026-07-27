import { createHash, randomBytes } from 'node:crypto';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  type SessionResponse,
  type User,
} from '@gridiron/contracts';
import { passwordResetTokens, users } from '@gridiron/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  purgeExpiredSessions,
  revokeAllSessions,
  revokeSession,
  setSessionCookie,
  type SessionUser,
} from '../auth/sessions';
import { isUniqueViolation } from '../data/db-errors';
import type { Deps } from '../deps';
import type { AppEnv } from '../http/context';
import { conflict, unauthorized } from '../http/errors';
import { rateLimit, requireAuth } from '../http/middleware';
import { readJson } from '../http/validate';

const HOUR_MS = 3_600_000;

function toUser(user: SessionUser): User {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * A hash of nothing in particular, verified against when an email doesn't exist.
 *
 * Without it a failed login returns in microseconds for an unknown address and ~50 ms
 * for a known one, which turns the login endpoint into an account-enumeration oracle.
 */
let decoyHash: Promise<string> | undefined;
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return decoyHash;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.post(
    '/auth/register',
    rateLimit(deps, { limit: 10, windowMs: HOUR_MS, key: 'register' }),
    async (c) => {
      const body = await readJson(c, registerRequestSchema);
      const passwordHash = await hashPassword(body.password);

      // The unique index is on `lower(email)`, an expression rather than a column, so
      // the collision is caught here rather than declared as an ON CONFLICT target.
      let row;
      try {
        const inserted = await deps.db
          .insert(users)
          .values({ email: body.email, passwordHash, displayName: body.displayName })
          .returning();
        row = inserted[0];
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('that email is already registered');
        throw error;
      }
      if (row === undefined) throw new Error('user insert returned nothing');

      const session = await createSession(deps, row.id);
      setSessionCookie(c, deps.config, session.token);

      const response: SessionResponse = {
        user: toUser(row),
        expiresAt: session.expiresAt.toISOString(),
      };
      return c.json(response, 201);
    },
  );

  app.post(
    '/auth/login',
    rateLimit(deps, { limit: 10, windowMs: 15 * 60_000, key: 'login' }),
    async (c) => {
      const body = await readJson(c, loginRequestSchema);

      const rows = await deps.db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.email})`, body.email))
        .limit(1);

      const user = rows[0];
      const ok = await verifyPassword(user?.passwordHash ?? (await decoy()), body.password);
      // One message for both failures — never confirm which half was wrong.
      if (user === undefined || !ok) throw unauthorized('invalid email or password');

      await purgeExpiredSessions(deps);
      const session = await createSession(deps, user.id);
      setSessionCookie(c, deps.config, session.token);

      const response: SessionResponse = {
        user: toUser(user),
        expiresAt: session.expiresAt.toISOString(),
      };
      return c.json(response);
    },
  );

  app.post('/auth/logout', requireAuth(deps), async (c) => {
    await revokeSession(deps, c.get('sessionId'));
    clearSessionCookie(c, deps.config);
    return c.body(null, 204);
  });

  app.get('/auth/me', requireAuth(deps), (c) => c.json({ user: toUser(c.get('user')) }));

  /**
   * Start a password reset.
   *
   * Always 202, whether or not the address exists — the response must not tell a
   * stranger which emails have accounts. The token itself is only ever seen by
   * whoever can read the mailbox.
   */
  app.post(
    '/auth/forgot-password',
    rateLimit(deps, { limit: 5, windowMs: HOUR_MS, key: 'forgot' }),
    async (c) => {
      const body = await readJson(c, forgotPasswordRequestSchema);

      const rows = await deps.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(sql`lower(${users.email})`, body.email))
        .limit(1);

      const user = rows[0];
      if (user !== undefined) {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(deps.now().getTime() + deps.config.resetTokenTtlMs);
        await deps.db
          .insert(passwordResetTokens)
          .values({ userId: user.id, tokenHash: hashToken(token), expiresAt });

        const link = `${deps.config.appUrl}/reset-password?token=${token}`;
        const minutes = Math.round(deps.config.resetTokenTtlMs / 60_000);
        await deps.mailer.send({
          to: user.email,
          subject: 'Reset your Gridiron password',
          text: `Open this link to choose a new password. It expires in ${String(minutes)} minutes.\n\n${link}\n\nIf you didn't ask for this, ignore it — nothing has changed.`,
        });
      }

      return c.json({ status: 'sent' }, 202);
    },
  );

  /**
   * Finish a password reset.
   *
   * Redeeming a token is one-shot and takes every session with it: if the reset was
   * prompted by a compromise, the attacker's cookie stops working at the same instant
   * the password changes.
   */
  app.post(
    '/auth/reset-password',
    rateLimit(deps, { limit: 10, windowMs: HOUR_MS, key: 'reset' }),
    async (c) => {
      const body = await readJson(c, resetPasswordRequestSchema);

      const rows = await deps.db
        .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(body.token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, deps.now()),
          ),
        )
        .limit(1);

      const token = rows[0];
      if (token === undefined) throw unauthorized('that reset link is invalid or expired');

      const passwordHash = await hashPassword(body.password);
      await deps.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: deps.now() })
          .where(eq(users.id, token.userId));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: deps.now() })
          .where(eq(passwordResetTokens.id, token.id));
      });
      await revokeAllSessions(deps, token.userId);

      clearSessionCookie(c, deps.config);
      return c.json({ status: 'reset' });
    },
  );

  return app;
}
