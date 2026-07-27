import { z } from 'zod';

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
  /** `console` prints the link to stdout; a real provider lands in Phase 5. */
  MAIL_TRANSPORT: z.enum(['console', 'memory']).default('console'),
  /**
   * Defaults on everywhere except tests, where dozens of accounts get registered from
   * one address in a second. The limiter's own test turns it back on explicitly.
   */
  RATE_LIMIT: z.enum(['on', 'off']).optional(),
});

export interface Config {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly sessionTtlMs: number;
  readonly resetTokenTtlMs: number;
  readonly mailTransport: 'console' | 'memory';
  readonly rateLimitEnabled: boolean;
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

  const extra = value.EXTRA_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    appUrl: value.APP_URL,
    allowedOrigins: [value.APP_URL, ...extra],
    sessionTtlMs: value.SESSION_TTL_DAYS * DAY_MS,
    resetTokenTtlMs: value.RESET_TOKEN_TTL_MINUTES * MINUTE_MS,
    mailTransport: value.MAIL_TRANSPORT,
    rateLimitEnabled:
      value.RATE_LIMIT === undefined ? value.NODE_ENV !== 'test' : value.RATE_LIMIT === 'on',
    cookieSecure: value.NODE_ENV === 'production',
  };
}
