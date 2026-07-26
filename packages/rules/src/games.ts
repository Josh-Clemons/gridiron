import type { Game, TeamId } from './types';

/**
 * The game a team plays in a given week, or `undefined` if it isn't playing —
 * a bye, or a team that doesn't exist in the schedule at all.
 */
export function findGame(games: readonly Game[], week: number, teamId: TeamId): Game | undefined {
  return games.find(
    (game) => game.week === week && (game.homeTeam === teamId || game.awayTeam === teamId),
  );
}

/** The other side of a game, or `undefined` if the team isn't in it. */
export function opponentOf(game: Game, teamId: TeamId): TeamId | undefined {
  if (game.homeTeam === teamId) return game.awayTeam;
  if (game.awayTeam === teamId) return game.homeTeam;
  return undefined;
}

export function gamesInWeek(games: readonly Game[], week: number): readonly Game[] {
  return games.filter((game) => game.week === week);
}

/**
 * Whether a game's kickoff has passed (rule 9).
 *
 * Picks lock per game, not per week — Thursday games close before Sunday ones. The
 * clock is always passed in rather than read here, so callers stay testable and the
 * UI can drive locking from a single ticking source.
 *
 * Kickoff itself counts as locked.
 */
export function isLocked(game: Game, now: Date): boolean {
  return now.getTime() >= game.kickoff.getTime();
}

/** Did this team win? Ties are losses (rule 7), and unfinished games are not wins. */
export function didTeamWin(game: Game, teamId: TeamId): boolean {
  return game.status === 'final' && game.winner === teamId;
}
