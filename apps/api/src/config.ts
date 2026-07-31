import { z } from 'zod';
import type { MatrixConfig } from './alerts/matrix-alerter';
import type { MailTransport } from './mail/mailer';
import type { ResendConfig } from './mail/resend-mailer';

/**
 * Runtime configuration, parsed once at startup.
 *
 * Everything the process needs comes from the environment and is validated here, so a
 * misconfigured container fails immediately and loudly rather than at the first
 * request that happens to need the missing value.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8082),
  /**
   * The interface to bind. Defaults to loopback, because anything on a non-localhost
   * address on the host is reachable from every tailnet peer.
   *
   * The container sets `0.0.0.0`, and that is not a loosening of the rule: a
   * container's `127.0.0.1` is its own, so binding loopback there would publish a port
   * nothing could reach. The isolation moves to Docker, which publishes to
   * `127.0.0.1:8082` on the host — the same address, enforced one layer out.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().min(1),
  /**
   * Where the browser reaches the app. Used to build password-reset links, and the
   * only origin allowed to send credentialed cross-origin requests.
   */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Extra dev origins, comma separated. Production is same-origin behind Caddy. */
  EXTRA_ORIGINS: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  /** `console` prints the link to stdout; `resend` is the production transport. */
  MAIL_TRANSPORT: z.enum(['console', 'memory', 'resend']).default('console'),
  RESEND_API_KEY: z.string().min(1).optional(),
  /** RFC 5322 sender on a Resend-verified domain. Required by `resend`. */
  MAIL_FROM: z.string().min(1).optional(),
  /**
   * Defaults on everywhere except tests, where dozens of accounts get registered from
   * one address in a second. The limiter's own test turns it back on explicitly.
   */
  RATE_LIMIT: z.enum(['on', 'off']).optional(),

  /**
   * Run the server at a simulated moment, as an ISO instant — for manual testing
   * against a finished season, where every kickoff is in the past and so every slot
   * would otherwise render locked.
   *
   * It sets an *offset* from real time rather than freezing the clock, so time still
   * advances from that instant and a slot can be watched locking. Refused outright in
   * production, where a wrong clock would silently accept picks after kickoff.
   */
  CLOCK_OVERRIDE: z.iso.datetime({ offset: true }).optional(),

  /** Overridable so tests can point the sync at a stub instead of the real endpoint. */
  ESPN_BASE_URL: z.url().optional(),
  ESPN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),

  /** All three or none. Without them, sync failures alert to stderr. */
  MATRIX_HOMESERVER: z.url().optional(),
  MATRIX_ACCESS_TOKEN: z.string().min(1).optional(),
  MATRIX_ALERT_ROOM: z.string().min(1).optional(),
});

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  /** Bind address. Loopback everywhere except inside the container — see `HOST`. */
  readonly host: string;
  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly sessionTtlMs: number;
  readonly resetTokenTtlMs: number;
  readonly mailTransport: MailTransport;
  /** Defined only when `mailTransport` is `resend`, where it is guaranteed. */
  readonly resend: ResendConfig | undefined;
  readonly rateLimitEnabled: boolean;
  /**
   * Milliseconds to add to the real clock. Zero in every normal run; non-zero only
   * when `CLOCK_OVERRIDE` is set, which production refuses.
   */
  readonly clockOffsetMs: number;
  readonly espnBaseUrl: string | undefined;
  readonly espnTimeoutMs: number;
  /** Undefined unless the homeserver, token and room are all configured. */
  readonly matrix: MatrixConfig | undefined;
  /**
   * `Secure` on the session cookie. Off in development because localhost is plain
   * HTTP; on everywhere else, where Caddy terminates TLS.
   */
  readonly cookieSecure: boolean;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid environment — ${detail}`);
  }
  const value = parsed.data;

  if (value.CLOCK_OVERRIDE !== undefined && value.NODE_ENV === 'production') {
    throw new Error('invalid environment — CLOCK_OVERRIDE must never be set in production');
  }

  if (
    value.MAIL_TRANSPORT === 'resend' &&
    (value.RESEND_API_KEY === undefined || value.MAIL_FROM === undefined)
  ) {
    throw new Error(
      'invalid environment — MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM',
    );
  }

  /**
   * The console transport prints reset links in full. In production that writes a
   * working credential into the journal and sends nothing to the player, so it is a
   * misconfiguration rather than a fallback.
   */
  if (value.NODE_ENV === 'production' && value.MAIL_TRANSPORT !== 'resend') {
    throw new Error(`invalid environment — production needs MAIL_TRANSPORT=resend`);
  }
  const clockOffsetMs =
    value.CLOCK_OVERRIDE === undefined ? 0 : Date.parse(value.CLOCK_OVERRIDE) - Date.now();

  const extra = value.EXTRA_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    host: value.HOST,
    databaseUrl: value.DATABASE_URL,
    appUrl: value.APP_URL,
    allowedOrigins: [value.APP_URL, ...extra],
    sessionTtlMs: value.SESSION_TTL_DAYS * DAY_MS,
    resetTokenTtlMs: value.RESET_TOKEN_TTL_MINUTES * MINUTE_MS,
    mailTransport: value.MAIL_TRANSPORT,
    resend:
      value.RESEND_API_KEY !== undefined && value.MAIL_FROM !== undefined
        ? { apiKey: value.RESEND_API_KEY, from: value.MAIL_FROM }
        : undefined,
    rateLimitEnabled:
      value.RATE_LIMIT === undefined ? value.NODE_ENV !== 'test' : value.RATE_LIMIT === 'on',
    clockOffsetMs,
    espnBaseUrl: value.ESPN_BASE_URL,
    espnTimeoutMs: value.ESPN_TIMEOUT_MS,
    matrix:
      value.MATRIX_HOMESERVER !== undefined &&
      value.MATRIX_ACCESS_TOKEN !== undefined &&
      value.MATRIX_ALERT_ROOM !== undefined
        ? {
            homeserver: value.MATRIX_HOMESERVER,
            accessToken: value.MATRIX_ACCESS_TOKEN,
            roomId: value.MATRIX_ALERT_ROOM,
          }
        : undefined,
    cookieSecure: value.NODE_ENV === 'production',
  };
}
