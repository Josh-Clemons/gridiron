import { createDatabase, games, seasons, teams } from '@gridiron/schema';
import { eq, sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { type App, createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDeps, type Db, type Deps } from '../src/deps';
import { MemoryMailer } from '../src/mail/memory-mailer';

export interface Harness {
  readonly app: App;
  readonly deps: Deps;
  readonly db: Db;
  readonly mailer: MemoryMailer;
  /** Move the injected clock. Every lock check in the system reads this. */
  setNow(when: Date): void;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Tables holding test-created data. Reference data (teams, seasons) survives. */
const MUTABLE_TABLES = [
  'pick_corrections',
  'picks',
  'pick_reminders',
  'sessions',
  'password_reset_tokens',
  'champions',
  'league_members',
  'leagues',
  'games',
  'users',
];

export interface HarnessOptions {
  /** Where the injected clock starts. Thursday of NFL week 1, 2026. */
  readonly now?: Date;
  /** Environment overrides, e.g. `{ RATE_LIMIT: 'on' }`. */
  readonly env?: Record<string, string>;
  /** Override the importer subprocess; tests fake it rather than spawn the CLI. */
  readonly runImporter?: import('../src/deps').Deps['runImporter'];
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const now = options.now ?? new Date('2026-09-10T12:00:00Z');
  const databaseUrl = inject('databaseUrl');
  const { db, sql: client } = createDatabase(databaseUrl, { max: 5 });

  let clock = now;
  const mailer = new MemoryMailer();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    APP_URL: 'http://localhost:5173',
    MAIL_TRANSPORT: 'memory',
    ...options.env,
  });

  const deps = createDeps({
    db,
    config,
    mailer,
    now: () => clock,
    ...(options.runImporter === undefined ? {} : { runImporter: options.runImporter }),
  });
  const app = createApp(deps);

  const harness: Harness = {
    app,
    deps,
    db,
    mailer,
    setNow(when: Date): void {
      clock = when;
    },
    async reset(): Promise<void> {
      await db.execute(
        sql.raw(`truncate table ${MUTABLE_TABLES.join(', ')} restart identity cascade`),
      );
      mailer.clear();
      clock = now;
    },
    async close(): Promise<void> {
      await client.end();
    },
  };

  await harness.reset();
  return harness;
}

interface ResponseOf<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

/**
 * An HTTP client that remembers cookies.
 *
 * Tests drive the app through `app.request`, so middleware, validation, cookies and
 * error handling all run exactly as they do in production. Two clients in one test are
 * two different browsers, which is how the "user A cannot touch user B's picks" cases
 * are written.
 */
export class ApiClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly app: App) {}

  get<T>(path: string): Promise<ResponseOf<T>> {
    return this.send<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<ResponseOf<T>> {
    return this.send<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<ResponseOf<T>> {
    return this.send<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<ResponseOf<T>> {
    return this.send<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<ResponseOf<T>> {
    return this.send<T>('DELETE', path);
  }

  /** Multipart POST; the caller builds the FormData and supplies the file part. */
  postForm<T>(path: string, form: FormData): Promise<ResponseOf<T>> {
    return this.sendForm<T>('POST', path, form);
  }

  /** A GET whose body is raw bytes, not JSON — the download route. */
  async getRaw(
    path: string,
  ): Promise<{ status: number; body: Uint8Array; contentType: string | null }> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await this.app.request(`http://localhost${path}`, { method: 'GET', headers });
    this.absorbCookies(response);
    const body = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, body, contentType: response.headers.get('content-type') };
  }

  private async sendForm<T>(method: string, path: string, form: FormData): Promise<ResponseOf<T>> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }

    // Content-type is left to fetch: it must set the multipart boundary itself.
    const response = await this.app.request(`http://localhost${path}`, {
      method,
      headers,
      body: form,
    });
    this.absorbCookies(response);

    const text = await response.text();
    const parsed: unknown = text === '' ? undefined : JSON.parse(text);
    return {
      status: response.status,
      /* eslint-disable-next-line typescript/no-unsafe-type-assertion --
       * Same reasoning as `send`: the test names the shape it expects. */
      body: parsed as T,
      headers: response.headers,
    };
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<ResponseOf<T>> {
    const headers: Record<string, string> = {};
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (body !== undefined) headers['content-type'] = 'application/json';

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await this.app.request(`http://localhost${path}`, init);
    this.absorbCookies(response);

    const text = await response.text();
    const parsed: unknown = text === '' ? undefined : JSON.parse(text);
    return {
      status: response.status,
      /* eslint-disable-next-line typescript/no-unsafe-type-assertion --
       * A JSON body is `unknown` until something names its shape. Each test states
       * what it expects and asserts against it, which is the point of the test. */
      body: parsed as T,
      headers: response.headers,
    };
  }

  private absorbCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      if (pair === undefined) continue;
      const index = pair.indexOf('=');
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get sessionCookie(): string | undefined {
    return this.cookies.get('gridiron_session');
  }
}

export interface GameSeed {
  readonly home: string;
  readonly away: string;
  readonly kickoff: Date;
  readonly winner?: string;
  readonly status?: 'scheduled' | 'final';
}

/**
 * Put a week of games on the schedule.
 *
 * Phase 3 fills this table from ESPN; until then the tests write it directly, which is
 * also how a replay of a historical week will work.
 */
export async function insertGames(
  db: Db,
  year: number,
  week: number,
  entries: readonly GameSeed[],
): Promise<void> {
  const [season] = await db.select().from(seasons).where(eq(seasons.year, year)).limit(1);
  if (season === undefined) throw new Error(`no season ${String(year)}`);

  const rows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const idOf = new Map(rows.map((row) => [row.code, row.id]));
  const require = (code: string): number => {
    const id = idOf.get(code);
    if (id === undefined) throw new Error(`no team ${code}`);
    return id;
  };

  await db.insert(games).values(
    entries.map((entry) => ({
      seasonId: season.id,
      week,
      homeTeamId: require(entry.home),
      awayTeamId: require(entry.away),
      kickoff: entry.kickoff,
      status:
        entry.status ?? (entry.winner === undefined ? ('scheduled' as const) : ('final' as const)),
      winnerTeamId: entry.winner === undefined ? null : require(entry.winner),
    })),
  );
}

export async function seasonIdFor(db: Db, year: number): Promise<number> {
  const [season] = await db.select().from(seasons).where(eq(seasons.year, year)).limit(1);
  if (season === undefined) throw new Error(`no season ${String(year)}`);
  return season.id;
}

/** Register and sign in a fresh account, returning a client that holds its session. */
export async function signUp(
  app: App,
  email: string,
  displayName = email.split('@')[0] ?? 'player',
): Promise<ApiClient> {
  const client = new ApiClient(app);
  const response = await client.post('/auth/register', {
    email,
    password: 'correct horse battery staple',
    displayName,
  });
  if (response.status !== 201) {
    throw new Error(`register failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return client;
}
