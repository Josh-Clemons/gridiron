import { passwordResetTokens } from '@gridiron/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, createHarness, type Harness, signUp } from './helpers';

let harness: Harness;

const countResetTokens = async (): Promise<number> =>
  (await harness.db.select().from(passwordResetTokens)).length;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

const PASSWORD = 'correct horse battery staple';

describe('registration', () => {
  it('creates an account and signs it in', async () => {
    const client = new ApiClient(harness.app);
    const registered = await client.post<{ user: { email: string; id: number } }>(
      '/auth/register',
      { email: 'Josh@Example.com', password: PASSWORD, displayName: 'Josh' },
    );

    expect(registered.status).toBe(201);
    // Stored lower-cased, so `Josh@` and `josh@` are the same account forever after.
    expect(registered.body.user.email).toBe('josh@example.com');

    const me = await client.get<{ user: { id: number } }>('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(registered.body.user.id);
  });

  it('puts the session in an httpOnly cookie and never in the body', async () => {
    const client = new ApiClient(harness.app);
    const response = await client.post('/auth/register', {
      email: 'cookie@example.com',
      password: PASSWORD,
      displayName: 'Cookie',
    });

    const cookie = response.headers
      .getSetCookie()
      .find((raw) => raw.startsWith('gridiron_session'));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(JSON.stringify(response.body)).not.toContain(client.sessionCookie ?? 'no-cookie');
  });

  it('rejects a duplicate email regardless of case', async () => {
    await signUp(harness.app, 'dupe@example.com');

    const second = await new ApiClient(harness.app).post('/auth/register', {
      email: 'DUPE@example.com',
      password: PASSWORD,
      displayName: 'Impostor',
    });

    expect(second.status).toBe(409);
  });

  it('rejects a short password before touching the database', async () => {
    const response = await new ApiClient(harness.app).post<{ error: { code: string } }>(
      '/auth/register',
      { email: 'short@example.com', password: 'short', displayName: 'Short' },
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('bad_request');
  });
});

describe('login', () => {
  it('gives the same answer for a wrong password and an unknown account', async () => {
    await signUp(harness.app, 'real@example.com');

    const wrongPassword = await new ApiClient(harness.app).post<{ error: { message: string } }>(
      '/auth/login',
      { email: 'real@example.com', password: 'not the password' },
    );
    const unknownUser = await new ApiClient(harness.app).post<{ error: { message: string } }>(
      '/auth/login',
      { email: 'ghost@example.com', password: PASSWORD },
    );

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('signs in with the right password', async () => {
    await signUp(harness.app, 'login@example.com');

    const client = new ApiClient(harness.app);
    const response = await client.post('/auth/login', {
      email: 'login@example.com',
      password: PASSWORD,
    });

    expect(response.status).toBe(200);
    expect((await client.get('/auth/me')).status).toBe(200);
  });
});

describe('logout', () => {
  it('revokes the session server-side', async () => {
    const client = await signUp(harness.app, 'bye@example.com');
    const token = client.sessionCookie;

    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);

    // The cookie is gone from the client, but the real check is that replaying the
    // old token doesn't work either — that's the difference from a signed JWT.
    const replay = new ApiClient(harness.app);
    const response = await harness.app.request('http://localhost/auth/me', {
      headers: { cookie: `gridiron_session=${token ?? ''}` },
    });
    expect(response.status).toBe(401);
    expect((await replay.get('/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('emails a link, invalidates every session, and is single-use', async () => {
    const client = await signUp(harness.app, 'reset@example.com');

    const asked = await client.post('/auth/forgot-password', { email: 'reset@example.com' });
    expect(asked.status).toBe(202);

    const message = harness.mailer.lastTo('reset@example.com');
    expect(message).toBeDefined();
    const token = /token=([\w-]+)/u.exec(message?.text ?? '')?.[1];
    expect(token).toBeDefined();

    const resetter = new ApiClient(harness.app);
    const reset = await resetter.post<{ user: { email: string } }>('/auth/reset-password', {
      token,
      password: 'a whole new password',
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user.email).toBe('reset@example.com');

    // Redeeming the token signs you in — no trip through the login form.
    const me = await resetter.get<{ user: { email: string } }>('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('reset@example.com');

    // The session that existed before the reset is dead, and the sweep that killed it
    // ran before the new one was minted rather than after.
    expect((await client.get('/auth/me')).status).toBe(401);

    const fresh = new ApiClient(harness.app);
    expect(
      (await fresh.post('/auth/login', { email: 'reset@example.com', password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (
        await fresh.post('/auth/login', {
          email: 'reset@example.com',
          password: 'a whole new password',
        })
      ).status,
    ).toBe(200);

    // Redeeming the same link twice fails.
    const replay = await new ApiClient(harness.app).post('/auth/reset-password', {
      token,
      password: 'yet another password',
    });
    expect(replay.status).toBe(401);
  });

  it('says the same thing for an address with no account', async () => {
    const response = await new ApiClient(harness.app).post('/auth/forgot-password', {
      email: 'nobody@example.com',
    });

    expect(response.status).toBe(202);
    expect(harness.mailer.sent).toHaveLength(0);
  });

  /**
   * Only a real address reaches the send, so a provider outage that surfaced as a 500
   * would answer differently for registered and unregistered emails — turning the one
   * route that deliberately reveals nothing into an account oracle.
   */
  it('still says the same thing when the mail provider is down', async () => {
    await signUp(harness.app, 'outage@example.com');
    const failure = vi.spyOn(harness.mailer, 'send').mockRejectedValue(new Error('resend is down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const known = await new ApiClient(harness.app).post('/auth/forgot-password', {
      email: 'outage@example.com',
    });
    const unknown = await new ApiClient(harness.app).post('/auth/forgot-password', {
      email: 'nobody@example.com',
    });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(failure).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('refuses an expired link', async () => {
    const client = await signUp(harness.app, 'slow@example.com');
    await client.post('/auth/forgot-password', { email: 'slow@example.com' });
    const token = /token=([\w-]+)/u.exec(
      harness.mailer.lastTo('slow@example.com')?.text ?? '',
    )?.[1];

    harness.setNow(new Date('2026-09-11T12:00:00Z'));

    const response = await new ApiClient(harness.app).post('/auth/reset-password', {
      token,
      password: 'too late for this',
    });
    expect(response.status).toBe(401);
  });

  /**
   * Abandoned requests are swept when the next token is issued, so the table tracks
   * outstanding resets rather than growing forever.
   */
  it('sweeps expired reset tokens that were never redeemed', async () => {
    await signUp(harness.app, 'sweeper@example.com');
    const client = new ApiClient(harness.app);

    await client.post('/auth/forgot-password', { email: 'sweeper@example.com' });
    expect(await countResetTokens()).toBe(1);

    // Still inside its hour: a second request adds to the first rather than replacing it.
    await client.post('/auth/forgot-password', { email: 'sweeper@example.com' });
    expect(await countResetTokens()).toBe(2);

    harness.setNow(new Date('2026-09-11T12:00:00Z'));
    await client.post('/auth/forgot-password', { email: 'sweeper@example.com' });
    expect(await countResetTokens()).toBe(1);
  });

  /**
   * A redeemed token is the only durable record that a password changed and when, so
   * the sweep leaves it alone even long after it expires.
   */
  it('keeps redeemed tokens as a record of the change', async () => {
    await signUp(harness.app, 'history@example.com');
    const client = new ApiClient(harness.app);

    await client.post('/auth/forgot-password', { email: 'history@example.com' });
    const token = /token=([\w-]+)/u.exec(
      harness.mailer.lastTo('history@example.com')?.text ?? '',
    )?.[1];
    await client.post('/auth/reset-password', { token, password: 'a brand new one' });

    // Well past its expiry, and past another sweep.
    harness.setNow(new Date('2026-10-01T12:00:00Z'));
    await client.post('/auth/forgot-password', { email: 'history@example.com' });

    const redeemed = (await harness.db.select().from(passwordResetTokens)).filter(
      (row) => row.usedAt !== null,
    );
    expect(redeemed).toHaveLength(1);
    expect(redeemed[0]?.usedAt?.toISOString()).toBe('2026-09-10T12:00:00.000Z');
  });

  /**
   * `created_at` defaults to Postgres' clock, which disagrees with the injected one by
   * months under CLOCK_OVERRIDE — stamping rows that expire before they were created.
   */
  it('stamps created_at from the injected clock, not the database clock', async () => {
    await signUp(harness.app, 'clock@example.com');
    await new ApiClient(harness.app).post('/auth/forgot-password', {
      email: 'clock@example.com',
    });

    const rows = await harness.db.select().from(passwordResetTokens);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.createdAt.toISOString()).toBe('2026-09-10T12:00:00.000Z');
    expect(row?.createdAt.getTime()).toBeLessThan(row?.expiresAt.getTime() ?? 0);
  });
});

describe('account settings', () => {
  it('updates the display name and email, and the session reflects it', async () => {
    const client = await signUp(harness.app, 'me@example.com', 'Before');

    const updated = await client.patch<{ user: { email: string; displayName: string } }>(
      '/auth/me',
      { displayName: 'After', email: 'NEW@example.com' },
    );

    expect(updated.status).toBe(200);
    expect(updated.body.user.displayName).toBe('After');
    expect(updated.body.user.email).toBe('new@example.com');

    const me = await client.get<{ user: { email: string; displayName: string } }>('/auth/me');
    expect(me.body.user.email).toBe('new@example.com');
    expect(me.body.user.displayName).toBe('After');
  });

  it('refuses an email another account already uses', async () => {
    await signUp(harness.app, 'taken@example.com');
    const client = await signUp(harness.app, 'me2@example.com');

    const response = await client.patch('/auth/me', {
      displayName: 'Me2',
      email: 'TAKEN@example.com',
    });

    expect(response.status).toBe(409);
  });

  it('changes the password, requiring the current one, and evicts other sessions', async () => {
    const primary = await signUp(harness.app, 'pwd@example.com');
    const other = new ApiClient(harness.app);
    await other.post('/auth/login', { email: 'pwd@example.com', password: PASSWORD });

    const wrong = await primary.post('/auth/me/password', {
      currentPassword: 'wrong password!!',
      newPassword: 'whatever at all',
    });
    expect(wrong.status).toBe(401);

    const changed = await primary.post('/auth/me/password', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new password',
    });
    expect(changed.status).toBe(204);

    // The changer keeps their own seat; the other browser is dropped.
    expect((await primary.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);

    const fresh = new ApiClient(harness.app);
    expect(
      (await fresh.post('/auth/login', { email: 'pwd@example.com', password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (
        await fresh.post('/auth/login', {
          email: 'pwd@example.com',
          password: 'a brand new password',
        })
      ).status,
    ).toBe(200);
  });

  it('leaves existing league roster labels to the commissioner', async () => {
    const client = await signUp(harness.app, 'label@example.com', 'Original');
    const created = await client.post<{ id: number }>('/leagues', { name: 'My League' });
    const leagueId = created.body.id;

    await client.patch('/auth/me', { displayName: 'New Name', email: 'label@example.com' });

    const members = await client.get<{ members: { displayName: string }[] }>(
      `/leagues/${String(leagueId)}/members`,
    );
    expect(members.body.members[0]?.displayName).toBe('Original');
  });

  it('requires a session', async () => {
    const anonymous = new ApiClient(harness.app);

    expect(
      (
        await anonymous.patch('/auth/me', {
          displayName: 'X',
          email: 'x@example.com',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await anonymous.post('/auth/me/password', {
          currentPassword: 'something',
          newPassword: 'something else',
        })
      ).status,
    ).toBe(401);
  });
});

describe('rate limiting', () => {
  it('cuts off repeated login attempts from one address', async () => {
    // Off by default under test — dozens of accounts get created per second here —
    // so this suite turns it back on to prove the limiter actually works.
    const limited = await createHarness({ env: { RATE_LIMIT: 'on' } });
    try {
      await limited.reset();
      await signUp(limited.app, 'target@example.com');

      const attacker = new ApiClient(limited.app);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop -- the limiter counts sequential attempts
        const response = await attacker.post('/auth/login', {
          email: 'target@example.com',
          password: 'guess number ' + String(attempt),
        });
        statuses.push(response.status);
      }

      expect(statuses.filter((status) => status === 401)).toHaveLength(10);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('unauthenticated access', () => {
  it('refuses anything behind requireAuth', async () => {
    const anonymous = new ApiClient(harness.app);

    expect((await anonymous.get('/auth/me')).status).toBe(401);
    expect((await anonymous.get('/leagues')).status).toBe(401);
    expect((await anonymous.post('/leagues', { name: 'Nope' })).status).toBe(401);
  });
});
