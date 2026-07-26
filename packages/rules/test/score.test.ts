import { describe, expect, it } from 'vitest';
import { MAX_WEEK_SCORE } from '../src/constants';
import { scoreSeason, scoreWeek } from '../src/score';
import type { Game } from '../src/types';
import { final, makePick, weekGames } from './fixtures';

/** Week 1 with KC, PHI and SF all winning; BUF/NYJ left unplayed. */
function week1(results: Partial<Record<string, string | null>> = {}): Game[] {
  return weekGames(1).map((game) => {
    const outcome = results[game.homeTeam];
    return outcome === undefined ? game : final(game, outcome);
  });
}

const sweepPicks = [
  makePick(1, 'win', 'KC'),
  makePick(1, 'place', 'PHI'),
  makePick(1, 'show', 'SF'),
];
const sweepGames = week1({ KC: 'KC', PHI: 'PHI', SF: 'SF' });

describe('scoreWeek', () => {
  it('awards each slot its own point value', () => {
    const score = scoreWeek(1, sweepPicks, sweepGames);
    expect(score.slots.map((slot) => [slot.slot, slot.points])).toEqual([
      ['win', 5],
      ['place', 3],
      ['show', 1],
    ]);
  });

  it('adds the Trifecta bonus for a clean sweep, totalling 11', () => {
    const score = scoreWeek(1, sweepPicks, sweepGames);
    expect(score.base).toBe(9);
    expect(score.trifecta).toBe(2);
    expect(score.total).toBe(11);
    expect(score.total).toBe(MAX_WEEK_SCORE);
    expect(score.settled).toBe(true);
  });

  it('withholds the Trifecta when any pick loses', () => {
    const games = week1({ KC: 'KC', PHI: 'DAL', SF: 'SF' });
    const score = scoreWeek(1, sweepPicks, games);
    expect(score.base).toBe(6);
    expect(score.trifecta).toBe(0);
    expect(score.total).toBe(6);
  });

  it('scores a tie as a loss (rule 7) and blocks the Trifecta', () => {
    const games = week1({ KC: 'KC', PHI: null, SF: 'SF' });
    const score = scoreWeek(1, sweepPicks, games);
    const place = score.slots.find((slot) => slot.slot === 'place');
    expect(place?.outcome).toBe('loss');
    expect(place?.points).toBe(0);
    expect(score.trifecta).toBe(0);
    expect(score.total).toBe(6);
  });

  it('scores 0 for a week where all three picks lose', () => {
    // This is an ordinary bad week, not a special state — the commissioner's
    // spreadsheet has many of them and they need no separate handling.
    const games = week1({ KC: 'BAL', PHI: 'DAL', SF: 'SEA' });
    const score = scoreWeek(1, sweepPicks, games);
    expect(score.total).toBe(0);
    expect(score.settled).toBe(true);
    expect(score.slots.every((slot) => slot.outcome === 'loss')).toBe(true);
  });

  it('marks unplayed games pending and the week unsettled', () => {
    const picks = [makePick(1, 'win', 'BUF')];
    const score = scoreWeek(1, picks, week1({ KC: 'KC' }));
    expect(score.slots.find((slot) => slot.slot === 'win')?.outcome).toBe('pending');
    expect(score.total).toBe(0);
    expect(score.settled).toBe(false);
  });

  it('reports empty slots without treating them as pending', () => {
    const score = scoreWeek(1, [makePick(1, 'win', 'KC')], sweepGames);
    expect(score.slots.find((slot) => slot.slot === 'place')?.outcome).toBe('empty');
    expect(score.slots.find((slot) => slot.slot === 'place')?.teamId).toBeNull();
    expect(score.total).toBe(5);
    // Nothing outstanding, so the week is final even though slots are unfilled.
    expect(score.settled).toBe(true);
  });

  it('never awards a Trifecta when a slot is empty', () => {
    const picks = [makePick(1, 'win', 'KC'), makePick(1, 'place', 'PHI')];
    const score = scoreWeek(1, picks, sweepGames);
    expect(score.base).toBe(8);
    expect(score.trifecta).toBe(0);
  });

  it('ignores picks from other weeks', () => {
    const picks = [...sweepPicks, makePick(2, 'win', 'BAL')];
    expect(scoreWeek(1, picks, sweepGames).total).toBe(11);
  });

  it('is pure — repeated calls give the same result', () => {
    const first = scoreWeek(1, sweepPicks, sweepGames);
    const second = scoreWeek(1, sweepPicks, sweepGames);
    expect(first).toEqual(second);
  });
});

describe('scoreSeason', () => {
  it('sums week totals across the season', () => {
    const games = [
      ...week1({ KC: 'KC', PHI: 'PHI', SF: 'SF' }),
      ...weekGames(2).map((game) => (game.homeTeam === 'KC' ? final(game, 'KC') : game)),
    ];
    const picks = [...sweepPicks, makePick(2, 'win', 'KC')];
    const season = scoreSeason(picks, games, 2);
    expect(season.weeks).toHaveLength(2);
    expect(season.weeks[0]?.total).toBe(11);
    expect(season.weeks[1]?.total).toBe(5);
    expect(season.total).toBe(16);
  });

  it('honours the season week count — 17 for 2020 and earlier', () => {
    expect(scoreSeason([], [], 17).weeks).toHaveLength(17);
    expect(scoreSeason([], [], 18).weeks).toHaveLength(18);
  });

  it('scores an empty season as zero rather than failing', () => {
    expect(scoreSeason([], [], 18).total).toBe(0);
  });
});
