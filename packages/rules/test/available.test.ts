import { describe, expect, it } from 'vitest';
import { availableTeamsFor, teamsRemainingForSlot } from '../src/available';
import { BEFORE_ANY_KICKOFF, kickoffFor, makePick, weekGames } from './fixtures';

const games = [...weekGames(1), ...weekGames(2)];

function optionsFor(
  overrides: Partial<Parameters<typeof availableTeamsFor>[0]> = {},
): ReturnType<typeof availableTeamsFor> {
  return availableTeamsFor({
    seasonPicks: [],
    games,
    week: 1,
    slot: 'win',
    now: BEFORE_ANY_KICKOFF,
    ...overrides,
  });
}

describe('availableTeamsFor', () => {
  it('returns every team playing that week, sorted', () => {
    const options = optionsFor();
    expect(options.map((option) => option.teamId)).toEqual([
      'BAL',
      'BUF',
      'DAL',
      'KC',
      'NYJ',
      'PHI',
      'SEA',
      'SF',
    ]);
  });

  it('includes the opponent and home/away for each option', () => {
    const kc = optionsFor().find((option) => option.teamId === 'KC');
    expect(kc).toMatchObject({ opponent: 'BAL', isHome: true, selectable: true });
    const bal = optionsFor().find((option) => option.teamId === 'BAL');
    expect(bal).toMatchObject({ opponent: 'KC', isHome: false });
  });

  it('surfaces unavailable teams rather than hiding them', () => {
    // The whole point: the UI greys these out with a reason instead of dropping them,
    // which is what the old app got wrong.
    const options = optionsFor({ seasonPicks: [makePick(2, 'win', 'KC')] });
    const kc = options.find((option) => option.teamId === 'KC');
    expect(kc?.selectable).toBe(false);
    expect(kc?.rejections.map((rejection) => rejection.code)).toEqual(['slot_used_this_season']);
    expect(options).toHaveLength(8);
  });

  it('marks the opponent of an existing pick unselectable', () => {
    const options = optionsFor({ slot: 'place', seasonPicks: [makePick(1, 'win', 'KC')] });
    expect(options.find((option) => option.teamId === 'BAL')?.selectable).toBe(false);
    expect(options.find((option) => option.teamId === 'SF')?.selectable).toBe(true);
  });

  it('marks only started games as locked', () => {
    const now = new Date(kickoffFor(1, 3, 17).getTime() + 1000);
    const options = optionsFor({ now });
    expect(options.find((option) => option.teamId === 'KC')?.selectable).toBe(false);
    expect(options.find((option) => option.teamId === 'BAL')?.selectable).toBe(false);
    expect(options.find((option) => option.teamId === 'BUF')?.selectable).toBe(true);
  });

  it('leaves rejections empty for selectable teams', () => {
    for (const option of optionsFor().filter((candidate) => candidate.selectable)) {
      expect(option.rejections).toEqual([]);
    }
  });
});

describe('teamsRemainingForSlot', () => {
  const allTeams = ['BAL', 'BUF', 'KC', 'PHI'];

  it('excludes teams already used in that slot', () => {
    const picks = [makePick(1, 'win', 'KC'), makePick(2, 'win', 'BAL')];
    expect(teamsRemainingForSlot(picks, 'win', allTeams)).toEqual(['BUF', 'PHI']);
  });

  it('tracks each slot independently', () => {
    const picks = [makePick(1, 'win', 'KC')];
    expect(teamsRemainingForSlot(picks, 'win', allTeams)).not.toContain('KC');
    expect(teamsRemainingForSlot(picks, 'place', allTeams)).toContain('KC');
    expect(teamsRemainingForSlot(picks, 'show', allTeams)).toContain('KC');
  });

  it('returns everything when nothing has been used', () => {
    expect(teamsRemainingForSlot([], 'show', allTeams)).toEqual(allTeams);
  });
});
