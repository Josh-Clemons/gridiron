import { describe, expect, it } from 'vitest';
import { didTeamWin, findGame, gamesInWeek, isLocked, opponentOf } from '../src/games';
import { final, kickoffFor, makeGame, weekGames } from './fixtures';

const games = [...weekGames(1), ...weekGames(2)];

describe('findGame', () => {
  it('finds a team whether home or away', () => {
    expect(findGame(games, 1, 'KC')?.awayTeam).toBe('BAL');
    expect(findGame(games, 1, 'BAL')?.homeTeam).toBe('KC');
  });

  it('scopes the search to the requested week', () => {
    expect(findGame(games, 2, 'KC')?.week).toBe(2);
  });

  it('returns undefined for a team on a bye', () => {
    expect(findGame(games, 1, 'DEN')).toBeUndefined();
  });
});

describe('opponentOf', () => {
  const game = makeGame({ homeTeam: 'KC', awayTeam: 'BAL' });

  it('returns the other side', () => {
    expect(opponentOf(game, 'KC')).toBe('BAL');
    expect(opponentOf(game, 'BAL')).toBe('KC');
  });

  it('returns undefined for a team not in the game', () => {
    expect(opponentOf(game, 'DEN')).toBeUndefined();
  });
});

describe('gamesInWeek', () => {
  it('returns only that week', () => {
    const week2 = gamesInWeek(games, 2);
    expect(week2).toHaveLength(4);
    expect(week2.every((game) => game.week === 2)).toBe(true);
  });
});

describe('isLocked', () => {
  const game = makeGame({ homeTeam: 'KC', awayTeam: 'BAL', kickoff: kickoffFor(1) });

  it('is open before kickoff and locked at or after it', () => {
    expect(isLocked(game, new Date(game.kickoff.getTime() - 1))).toBe(false);
    expect(isLocked(game, game.kickoff)).toBe(true);
    expect(isLocked(game, new Date(game.kickoff.getTime() + 1))).toBe(true);
  });
});

describe('didTeamWin', () => {
  const scheduled = makeGame({ homeTeam: 'KC', awayTeam: 'BAL' });

  it('is false while the game is unplayed, even for the eventual winner', () => {
    expect(didTeamWin(scheduled, 'KC')).toBe(false);
  });

  it('is true only for the winner', () => {
    const played = final(scheduled, 'KC');
    expect(didTeamWin(played, 'KC')).toBe(true);
    expect(didTeamWin(played, 'BAL')).toBe(false);
  });

  it('is false for both teams on a tie', () => {
    const tied = final(scheduled, null);
    expect(didTeamWin(tied, 'KC')).toBe(false);
    expect(didTeamWin(tied, 'BAL')).toBe(false);
  });
});
