import type { Game, GameStatus, Pick, Slot, TeamId } from '../src/types';

/** Fixed reference point so no test depends on the real clock. */
export const SEASON_START = new Date('2026-09-10T00:20:00Z');

/** Well before any week-1 kickoff. */
export const BEFORE_ANY_KICKOFF = new Date('2026-09-01T00:00:00Z');

export function kickoffFor(week: number, dayOffset = 3, hour = 17): Date {
  const date = new Date(SEASON_START);
  date.setUTCDate(date.getUTCDate() + (week - 1) * 7 + dayOffset);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

export interface GameSpec {
  readonly week?: number;
  readonly homeTeam: TeamId;
  readonly awayTeam: TeamId;
  readonly kickoff?: Date;
  readonly status?: GameStatus;
  readonly winner?: TeamId | null;
  readonly id?: GameId_;
}

type GameId_ = string;

let gameCounter = 0;

export function makeGame(spec: GameSpec): Game {
  gameCounter += 1;
  const week = spec.week ?? 1;
  return {
    id: spec.id ?? `g${String(gameCounter)}`,
    week,
    homeTeam: spec.homeTeam,
    awayTeam: spec.awayTeam,
    kickoff: spec.kickoff ?? kickoffFor(week),
    status: spec.status ?? 'scheduled',
    winner: spec.winner ?? null,
  };
}

export function makePick(week: number, slot: Slot, teamId: TeamId): Pick {
  return { week, slot, teamId };
}

/**
 * A four-game week. Kickoffs are staggered across Thursday/Sunday/Monday so per-game
 * locking can be exercised, and the pairings make same-game conflicts easy to set up.
 */
export function weekGames(week: number): Game[] {
  return [
    makeGame({ week, homeTeam: 'KC', awayTeam: 'BAL', kickoff: kickoffFor(week, 3, 17) }),
    makeGame({ week, homeTeam: 'PHI', awayTeam: 'DAL', kickoff: kickoffFor(week, 6, 17) }),
    makeGame({ week, homeTeam: 'SF', awayTeam: 'SEA', kickoff: kickoffFor(week, 6, 20) }),
    makeGame({ week, homeTeam: 'BUF', awayTeam: 'NYJ', kickoff: kickoffFor(week, 7, 1) }),
  ];
}

/** Mark a game final with the given winner; `null` records a tie. */
export function final(game: Game, winner: TeamId | null): Game {
  return { ...game, status: 'final', winner };
}
