import { z } from 'zod';

/**
 * The one file that knows what ESPN's JSON looks like.
 *
 * The scoreboard endpoint is undocumented, unauthenticated and unversioned — it can
 * change without notice, and the old Java app read it inline in a service class. Here
 * every field we depend on is named in one schema, so a shape change is a parse error
 * in a single place with a message that says which field went missing, rather than
 * silently-zero scores three weeks into the season.
 *
 * Historical seasons come from the same endpoint: `dates=YYYY&seasontype=2&week=N`
 * returns finals with winners going back well past 2020.
 */
export const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

const competitorSchema = z.object({
  homeAway: z.enum(['home', 'away']),
  /** Absent before kickoff; `false` on both sides of a tie. */
  winner: z.boolean().nullish(),
  team: z.object({ abbreviation: z.string().min(1) }),
});

const eventSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  name: z.string().optional(),
  week: z.object({ number: z.number().int().positive() }).optional(),
  status: z.object({
    type: z.object({
      name: z.string(),
      state: z.string(),
      completed: z.boolean(),
    }),
  }),
  competitions: z.array(z.object({ competitors: z.array(competitorSchema).length(2) })).min(1),
});

const scoreboardSchema = z.object({
  season: z.object({ year: z.number().int() }).optional(),
  week: z.object({ number: z.number().int() }).optional(),
  events: z.array(eventSchema),
});

/** One scheduled or completed game, in our vocabulary rather than ESPN's. */
export interface EspnGame {
  /** ESPN's event id. Re-syncing updates the same row instead of duplicating it. */
  readonly externalId: string;
  readonly week: number;
  /** ESPN abbreviations, which are also our canonical codes. */
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoff: Date;
  readonly status: 'scheduled' | 'final';
  /** The winning team, or `null` for a tie or an unfinished game. */
  readonly winner: string | null;
}

/** Anything wrong with a sync — network, shape, or contents. Never swallowed. */
export class EspnError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EspnError';
  }
}

export interface FetchContext {
  readonly year: number;
  readonly week: number;
}

/**
 * Turn one scoreboard payload into games.
 *
 * Exported on its own so the parser can be tested against recorded fixtures without a
 * network — including the 2020 week-3 tie, which is the case that matters most and the
 * one hardest to reproduce on demand.
 */
export function parseScoreboard(payload: unknown, context: FetchContext): EspnGame[] {
  const parsed = scoreboardSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new EspnError(
      `ESPN returned an unexpected shape for ${String(context.year)} week ${String(context.week)} — ${detail}`,
    );
  }

  // A regular-season week always has games. An empty list means the parameters were
  // wrong or the endpoint changed, and treating it as "no games" would quietly wipe a
  // week's schedule.
  if (parsed.data.events.length === 0) {
    throw new EspnError(
      `ESPN returned no games for ${String(context.year)} week ${String(context.week)}`,
    );
  }

  return parsed.data.events.map((event) => toGame(event, context));
}

function toGame(event: z.infer<typeof eventSchema>, context: FetchContext): EspnGame {
  const competition = event.competitions[0];
  if (competition === undefined) {
    throw new EspnError(`event ${event.id} has no competition`);
  }

  const home = competition.competitors.find((side) => side.homeAway === 'home');
  const away = competition.competitors.find((side) => side.homeAway === 'away');
  if (home === undefined || away === undefined) {
    throw new EspnError(`event ${event.id} is missing a home or away side`);
  }

  const kickoff = new Date(event.date);
  if (Number.isNaN(kickoff.getTime())) {
    throw new EspnError(`event ${event.id} has an unparseable date "${event.date}"`);
  }

  const completed = event.status.type.completed;
  const winners = [home, away].filter((side) => side.winner === true);
  if (winners.length > 1) {
    throw new EspnError(`event ${event.id} reports two winners`);
  }

  return {
    externalId: event.id,
    // The requested week is authoritative; the event's own week is a cross-check.
    week: event.week?.number ?? context.week,
    homeTeam: home.team.abbreviation,
    awayTeam: away.team.abbreviation,
    kickoff,
    // In-progress games stay `scheduled`: they have no winner yet, and picks are
    // already locked by kickoff, so nothing depends on a separate live state.
    status: completed ? 'final' : 'scheduled',
    // A tie is `final` with no winner — rule 7 scores it as a loss for both sides,
    // which is exactly how the engine treats a null winner.
    winner: completed ? (winners[0]?.team.abbreviation ?? null) : null,
  };
}

export interface EspnClient {
  fetchWeek(year: number, week: number): Promise<EspnGame[]>;
}

export interface EspnClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

export function createEspnClient(options: EspnClientOptions = {}): EspnClient {
  const baseUrl = options.baseUrl ?? ESPN_BASE_URL;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async fetchWeek(year: number, week: number): Promise<EspnGame[]> {
      // seasontype=2 is the regular season. Playoffs (3) are out of scope.
      const url = `${baseUrl}/scoreboard?dates=${String(year)}&seasontype=2&week=${String(week)}`;

      let response: Response;
      try {
        response = await doFetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        throw new EspnError(`ESPN request failed for ${String(year)} week ${String(week)}`, {
          cause: error,
        });
      }

      if (!response.ok) {
        throw new EspnError(
          `ESPN returned ${String(response.status)} for ${String(year)} week ${String(week)}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new EspnError(`ESPN returned invalid JSON for ${String(year)} week ${String(week)}`, {
          cause: error,
        });
      }

      return parseScoreboard(payload, { year, week });
    },
  };
}
