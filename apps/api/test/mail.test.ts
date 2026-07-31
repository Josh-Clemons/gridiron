import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { ConsoleMailer, createMailer, mailerFor } from '../src/mail/mailer';
import { MemoryMailer } from '../src/mail/memory-mailer';
import { ResendMailer } from '../src/mail/resend-mailer';

const RESEND = { apiKey: 'key_test', from: 'Gridiron <noreply@mail.gridironpicks.us>' };

const MESSAGE = {
  to: 'player@example.com',
  subject: 'Reset your Gridiron password',
  text: 'https://gridironpicks.us/reset-password?token=abc',
};

/** The minimum a config needs; each test overrides only what it is about. */
const BASE_ENV = {
  DATABASE_URL: 'postgres://gridiron:gridiron@127.0.0.1:5433/gridiron',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the resend transport', () => {
  it('posts the message as json with the api key', async () => {
    // Captured from inside the mock, where fetch's own signature types the arguments.
    let sent: { url: string; method: string; auth: string | null; body: string } | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      sent = {
        url: url instanceof Request ? url.url : url.toString(),
        method: init?.method ?? '',
        auth: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : '',
      };
      return Promise.resolve(new Response('{"id":"abc"}', { status: 200 }));
    });

    await new ResendMailer(RESEND).send(MESSAGE);

    expect(sent?.url).toBe('https://api.resend.com/emails');
    expect(sent?.method).toBe('POST');
    expect(sent?.auth).toBe('Bearer key_test');
    expect(JSON.parse(sent?.body ?? '')).toEqual({
      from: RESEND.from,
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    });
  });

  /**
   * A rejected send has to be loud. Resend answers an unverified `from` with a 403,
   * which is the single likeliest way this is misconfigured on the first deploy.
   */
  it('throws with the provider detail when the api rejects the send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"message":"domain is not verified"}', { status: 403 }),
    );

    await expect(new ResendMailer(RESEND).send(MESSAGE)).rejects.toThrow(
      /resend returned 403.*domain is not verified/su,
    );
  });

  it('throws when the api cannot be reached at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(new ResendMailer(RESEND).send(MESSAGE)).rejects.toThrow(/resend unreachable/u);
  });
});

describe('choosing a transport', () => {
  it('builds each transport by name', () => {
    expect(createMailer('memory')).toBeInstanceOf(MemoryMailer);
    expect(createMailer('console')).toBeInstanceOf(ConsoleMailer);
    expect(createMailer('resend', RESEND)).toBeInstanceOf(ResendMailer);
  });

  it('refuses resend without credentials rather than falling back to the console', () => {
    expect(() => createMailer('resend')).toThrow(/requires RESEND_API_KEY/u);
  });

  /**
   * The regression this exists for: the sync CLI called `createMailer(transport)`
   * and dropped the credentials. That type-checks, and under the development
   * default (`console`) it works — so it failed for the first time in production,
   * where it would have killed every scheduled ESPN sync at startup. `mailerFor`
   * takes the whole config, which is the only argument shape that can't be got
   * half-right.
   */
  it('builds a working resend mailer from a production config', () => {
    const config = loadConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: RESEND.apiKey,
      MAIL_FROM: RESEND.from,
    });

    expect(mailerFor(config)).toBeInstanceOf(ResendMailer);
  });
});

describe('mail configuration', () => {
  it('carries the resend credentials through when both are set', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: RESEND.apiKey,
      MAIL_FROM: RESEND.from,
    });

    expect(config.mailTransport).toBe('resend');
    expect(config.resend).toEqual(RESEND);
  });

  it('rejects the resend transport with the credentials missing', () => {
    expect(() => loadConfig({ ...BASE_ENV, MAIL_TRANSPORT: 'resend' })).toThrow(
      /needs RESEND_API_KEY and MAIL_FROM/u,
    );
  });

  /**
   * The console transport writes a working reset link into the log and mails nobody.
   * Reaching production with it is a mistake worth refusing to boot over.
   */
  it('refuses to start in production without a real transport', () => {
    expect(() =>
      loadConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        APP_URL: 'https://gridironpicks.us',
      }),
    ).toThrow(/production needs MAIL_TRANSPORT=resend/u);
  });

  it('leaves development on the console transport', () => {
    const config = loadConfig(BASE_ENV);

    expect(config.mailTransport).toBe('console');
    expect(config.resend).toBeUndefined();
  });
});
