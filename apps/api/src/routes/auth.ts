import { createHash, randomBytes } from 'node:crypto';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
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
  purgeExpiredResetTokens,
  purgeExpiredSessions,
  revokeAllSessions,
  revokeOtherSessions,
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
   * Update the signed-in player's own profile.
   *
   * `displayName` is the global label new leagues default to; nothing here touches an
   * existing league's roster label, which belongs to the commissioner (Phase 7 rename).
   * The email change is guarded by the `lower(email)` unique index — a collision is
   * caught rather than declared as an ON CONFLICT target, same as registration.
   */
  app.patch('/auth/me', requireAuth(deps), async (c) => {
    const user = c.get('user');
    const body = await readJson(c, updateProfileRequestSchema);

    let updated;
    try {
      const rows = await deps.db
        .update(users)
        .set({ displayName: body.displayName, email: body.email, updatedAt: deps.now() })
        .where(eq(users.id, user.id))
        .returning();
      updated = rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('that email is already registered');
      throw error;
    }
    if (updated === undefined) throw new Error('profile update matched no user');

    return c.json({ user: toUser(updated) });
  });

  /**
   * Change the signed-in player's password.
   *
   * Requires the current password so a hijacked session can't lock the owner out, and
   * drops every other session so a hijacker who *was* in gets evicted at the same
   * instant. The caller's own session survives — they just proved who they are.
   */
  app.post('/auth/me/password', requireAuth(deps), async (c) => {
    const user = c.get('user');
    const body = await readJson(c, changePasswordRequestSchema);

    const rows = await deps.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw new Error('password change matched no user');

    const ok = await verifyPassword(row.passwordHash, body.currentPassword);
    if (!ok) throw unauthorized('current password is wrong');

    const passwordHash = await hashPassword(body.newPassword);
    await deps.db
      .update(users)
      .set({ passwordHash, updatedAt: deps.now() })
      .where(eq(users.id, user.id));

    await revokeOtherSessions(deps, user.id, c.get('sessionId'));
    return c.body(null, 204);
  });

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
        await purgeExpiredResetTokens(deps);

        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(deps.now().getTime() + deps.config.resetTokenTtlMs);
        await deps.db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt,
          createdAt: deps.now(),
        });

        const link = `${deps.config.appUrl}/reset-password?token=${token}`;
        const minutes = Math.round(deps.config.resetTokenTtlMs / 60_000);
        try {
          await deps.mailer.send({
            to: user.email,
            subject: 'Reset your Gridiron password',
            text: `Open this link to choose a new password. It expires in ${String(minutes)} minutes.\n\n${link}\n\nIf you didn't ask for this, ignore it — nothing has changed.`,
          });
        } catch (error) {
          /**
           * A provider outage must not become an account oracle. Only a real address
           * reaches this send, so letting the error escape would answer 500 for
           * registered emails and 202 for everyone else — precisely the distinction
           * this route exists to hide. The operator finds it in the log instead.
           */
          console.error('[mail] password reset could not be sent', error);
        }
      }

      return c.json({ status: 'sent' }, 202);
    },
  );

  /**
   * Finish a password reset, and sign the user in.
   *
   * Redeeming a token is one-shot and takes every session with it: if the reset was
   * prompted by a compromise, the attacker's cookie stops working at the same instant
   * the password changes. The fresh session is minted *after* that sweep, so it is the
   * only one left standing — reversed, this would revoke the session it just issued.
   *
   * Handing back a session rather than a redirect to the sign-in form costs nothing:
   * whoever redeemed the token chose the new password and could simply type it. The
   * mailbox is already the root of trust for the account, so requiring a login here
   * would be friction in front of a door that is open either way.
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
      const updated = await deps.db.transaction(async (tx) => {
        const changed = await tx
          .update(users)
          .set({ passwordHash, updatedAt: deps.now() })
          .where(eq(users.id, token.userId))
          .returning();
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: deps.now() })
          .where(eq(passwordResetTokens.id, token.id));
        return changed[0];
      });
      if (updated === undefined) throw new Error('password reset matched no user');

      await revokeAllSessions(deps, token.userId);

      const session = await createSession(deps, token.userId);
      setSessionCookie(c, deps.config, session.token);

      const response: SessionResponse = {
        user: toUser(updated),
        expiresAt: session.expiresAt.toISOString(),
      };
      return c.json(response);
    },
  );

  return app;
}
