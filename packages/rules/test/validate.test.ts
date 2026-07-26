import { describe, expect, it } from 'vitest';
import { describeRejection, validatePick } from '../src/validate';
import type { PickRejection } from '../src/validate';
import { BEFORE_ANY_KICKOFF, kickoffFor, makePick, weekGames } from './fixtures';

const games = [...weekGames(1), ...weekGames(2), ...weekGames(3), ...weekGames(4)];

function codes(rejections: readonly PickRejection[]): string[] {
  return rejections.map((rejection) => rejection.code).toSorted();
}

function validate(
  overrides: Partial<Parameters<typeof validatePick>[0]> = {},
): ReturnType<typeof validatePick> {
  return validatePick({
    seasonPicks: [],
    games,
    week: 1,
    slot: 'win',
    teamId: 'KC',
    now: BEFORE_ANY_KICKOFF,
    ...overrides,
  });
}

describe('validatePick', () => {
  it('accepts a clean pick', () => {
    expect(validate()).toEqual({ ok: true });
  });

  it('rejects a team with no game that week', () => {
    const result = validate({ teamId: 'DEN' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.rejections)).toEqual(['team_not_playing']);
  });

  describe('rule 6 — one use per slot per season', () => {
    it('rejects reusing a team in the same slot', () => {
      const result = validate({
        week: 2,
        slot: 'win',
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections).toEqual([
        { code: 'slot_used_this_season', teamId: 'KC', slot: 'win', usedInWeek: 1 },
      ]);
    });

    it('allows the same team in a different slot', () => {
      const result = validate({
        week: 2,
        slot: 'place',
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result).toEqual({ ok: true });
    });

    it('allows a team three times across three different slots', () => {
      const result = validate({
        week: 3,
        slot: 'show',
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC'), makePick(2, 'place', 'KC')],
      });
      expect(result).toEqual({ ok: true });
    });

    it('rejects a fourth use, since all three slots are spent', () => {
      // Week 4 is untouched by these picks, so nothing here is a self-replacement.
      const seasonPicks = [
        makePick(1, 'win', 'KC'),
        makePick(2, 'place', 'KC'),
        makePick(3, 'show', 'KC'),
      ];
      for (const slot of ['win', 'place', 'show'] as const) {
        const result = validate({ week: 4, slot, teamId: 'KC', seasonPicks });
        expect(result.ok, `slot ${slot} should be spent`).toBe(false);
      }
    });
  });

  describe('rule 2 — three different teams in a week', () => {
    it('rejects the same team twice in one week', () => {
      const result = validate({
        slot: 'place',
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Also breaks rule 6, since it is the same team in a slot it already occupies
      // for the season — both reasons are reported.
      expect(codes(result.rejections)).toContain('duplicate_team_this_week');
    });
  });

  describe('rule 8 — not both teams from one game', () => {
    it('rejects the opponent of a team already picked this week', () => {
      const result = validate({
        slot: 'place',
        teamId: 'BAL',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejections).toEqual([
        { code: 'same_game_as_other_pick', teamId: 'BAL', otherSlot: 'win', otherTeamId: 'KC' },
      ]);
    });

    it('allows the same matchup in a different week', () => {
      const result = validate({
        week: 2,
        slot: 'place',
        teamId: 'BAL',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe('rule 9 — per-game kickoff lock', () => {
    it('rejects a pick made after kickoff', () => {
      const result = validate({ now: new Date(kickoffFor(1, 3, 17).getTime() + 1000) });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codes(result.rejections)).toEqual(['game_locked']);
    });

    it('treats the kickoff instant itself as locked', () => {
      const result = validate({ now: kickoffFor(1, 3, 17) });
      expect(result.ok).toBe(false);
    });

    it('accepts a pick one millisecond before kickoff', () => {
      const result = validate({ now: new Date(kickoffFor(1, 3, 17).getTime() - 1) });
      expect(result).toEqual({ ok: true });
    });

    it('locks games individually — a later game stays open', () => {
      // Thursday KC/BAL has started; Monday BUF/NYJ has not.
      const now = new Date(kickoffFor(1, 3, 17).getTime() + 1000);
      expect(validate({ teamId: 'KC', now }).ok).toBe(false);
      expect(validate({ teamId: 'BUF', now })).toEqual({ ok: true });
    });

    it('ignoreLock bypasses the lock for historical imports', () => {
      const result = validate({
        now: new Date(kickoffFor(1, 3, 17).getTime() + 1000),
        ignoreLock: true,
      });
      expect(result).toEqual({ ok: true });
    });

    it('ignoreLock does not bypass any other rule', () => {
      const result = validate({
        week: 2,
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC')],
        ignoreLock: true,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('replacing an existing pick', () => {
    it('does not treat the slot being overwritten as a conflict', () => {
      // Re-selecting the team already in this exact slot must be a no-op, not a
      // self-collision against rules 2, 6 and 8 all at once.
      const result = validate({
        slot: 'win',
        teamId: 'KC',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result).toEqual({ ok: true });
    });

    it('allows swapping to the opponent of the team currently in that slot', () => {
      const result = validate({
        slot: 'win',
        teamId: 'BAL',
        seasonPicks: [makePick(1, 'win', 'KC')],
      });
      expect(result).toEqual({ ok: true });
    });
  });

  it('reports every reason a pick fails, not just the first', () => {
    // SEA is on a locked... no: SEA plays SF. Pick SF at 'win' having already used SF
    // at 'win' in week 2, with SEA already this week's 'place' pick.
    const result = validate({
      slot: 'win',
      teamId: 'SF',
      seasonPicks: [makePick(2, 'win', 'SF'), makePick(1, 'place', 'SEA')],
      now: new Date(kickoffFor(1, 6, 20).getTime() + 1000),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.rejections)).toEqual([
      'game_locked',
      'same_game_as_other_pick',
      'slot_used_this_season',
    ]);
  });
});

describe('describeRejection', () => {
  it('produces a message for every rejection code', () => {
    const samples: PickRejection[] = [
      { code: 'team_not_playing', teamId: 'DEN', week: 1 },
      { code: 'game_locked', teamId: 'KC', kickoff: kickoffFor(1) },
      { code: 'slot_used_this_season', teamId: 'KC', slot: 'win', usedInWeek: 3 },
      { code: 'duplicate_team_this_week', teamId: 'KC', otherSlot: 'place' },
      { code: 'same_game_as_other_pick', teamId: 'BAL', otherSlot: 'win', otherTeamId: 'KC' },
    ];
    for (const sample of samples) {
      expect(describeRejection(sample), sample.code).toMatch(/\S/u);
    }
  });

  it('uses the pool vocabulary rather than point values', () => {
    const message = describeRejection({
      code: 'slot_used_this_season',
      teamId: 'KC',
      slot: 'win',
      usedInWeek: 3,
    });
    expect(message).toContain('Win');
    expect(message).toContain('week 3');
  });
});
