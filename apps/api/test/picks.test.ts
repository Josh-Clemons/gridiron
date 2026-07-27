import { picks, teams } from '@gridiron/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiClient,
  createHarness,
  type Harness,
  insertGames,
  seasonIdFor,
  signUp,
} from './helpers';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

const THURSDAY = new Date('2026-09-10T23:20:00Z');
const SUNDAY = new Date('2026-09-13T17:00:00Z');
const MONDAY = new Date('2026-09-15T00:15:00Z');

interface Setup {
  readonly owner: ApiClient;
  readonly guest: ApiClient;
  readonly leagueId: number;
}

/** A two-member league with two weeks of schedule loaded. */
async function setup(): Promise<Setup> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Owner');
  const created = await owner.post<{ id: number; inviteCode: string }>('/leagues', {
    name: 'Grid Iron',
  });
  const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
  await guest.post('/leagues/join', { inviteCode: created.body.inviteCode });

  await insertGames(harness.db, 2026, 1, [
    { home: 'KC', away: 'DEN', kickoff: THURSDAY },
    { home: 'BUF', away: 'NYJ', kickoff: SUNDAY },
    { home: 'DAL', away: 'PHI', kickoff: SUNDAY },
    { home: 'SF', away: 'SEA', kickoff: MONDAY },
  ]);
  await insertGames(harness.db, 2026, 2, [
    { home: 'KC', away: 'BUF', kickoff: new Date('2026-09-20T17:00:00Z') },
    { home: 'DEN', away: 'DAL', kickoff: new Date('2026-09-20T17:00:00Z') },
    { home: 'SEA', away: 'NYJ', kickoff: new Date('2026-09-20T20:05:00Z') },
  ]);

  return { owner, guest, leagueId: created.body.id };
}

interface RejectionBody {
  error: { code: string; rejections?: { code: string }[] };
}

interface BoardBody {
  week: number;
  games: { homeTeam: string; locked: boolean }[];
  picks: { slot: string; teamId: string; source: string; locked: boolean; points: number }[];
  weekScore: { base: number; trifecta: number; total: number; settled: boolean };
  seasonPoints: number;
  standings: { memberId: number; displayName: string; seasonPoints: number; rank: number }[];
}

const rejectionCodes = (body: RejectionBody): string[] =>
  (body.error.rejections ?? []).map((rejection) => rejection.code);

beforeEach(async () => {
  await harness.reset();
});

describe('making picks', () => {
  it('saves a pick and shows it on the board', async () => {
    const { owner, leagueId } = await setup();

    const saved = await owner.put<{ pick: { teamId: string; source: string } }>(
      `/leagues/${String(leagueId)}/picks/1/win`,
      { teamId: 'KC' },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.pick.source).toBe('app');

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.picks).toEqual([
      expect.objectContaining({ slot: 'win', teamId: 'KC', outcome: 'pending' }),
    ]);
  });

  it('accepts a spreadsheet spelling and stores the canonical code', async () => {
    const { owner, leagueId } = await setup();
    await insertGames(harness.db, 2026, 3, [
      { home: 'ARI', away: 'NO', kickoff: new Date('2026-09-27T17:00:00Z') },
    ]);

    // The commissioner's workbook writes ARZ where ESPN writes ARI.
    const saved = await owner.put<{ pick: { teamId: string } }>(
      `/leagues/${String(leagueId)}/picks/3/win`,
      { teamId: 'ARZ' },
    );

    expect(saved.status).toBe(200);
    expect(saved.body.pick.teamId).toBe('ARI');
  });

  it('replaces the team in a slot rather than adding a second row', async () => {
    const { owner, leagueId } = await setup();

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    const replaced = await owner.put<{ pick: { teamId: string } }>(
      `/leagues/${String(leagueId)}/picks/1/win`,
      { teamId: 'BUF' },
    );

    expect(replaced.status).toBe(200);
    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.picks).toHaveLength(1);
    expect(board.body.picks[0]?.teamId).toBe('BUF');
  });

  it('clears a slot, and refuses to clear it twice', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'DAL' });

    expect((await owner.delete(`/leagues/${String(leagueId)}/picks/1/show`)).status).toBe(200);
    expect((await owner.delete(`/leagues/${String(leagueId)}/picks/1/show`)).status).toBe(404);

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.picks).toHaveLength(0);
  });
});

describe('rule enforcement on the server', () => {
  it('refuses both teams from the same game', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'BUF' });

    const response = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/place`, {
      teamId: 'NYJ',
    });

    expect(response.status).toBe(422);
    expect(rejectionCodes(response.body)).toContain('same_game_as_other_pick');
  });

  it('refuses the same team twice in one week', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'DAL' });

    const response = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/place`, {
      teamId: 'DAL',
    });

    expect(response.status).toBe(422);
    expect(rejectionCodes(response.body)).toContain('duplicate_team_this_week');
  });

  it('refuses a team already used in that slot this season', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const response = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/2/win`, {
      teamId: 'KC',
    });

    expect(response.status).toBe(422);
    expect(rejectionCodes(response.body)).toContain('slot_used_this_season');
  });

  it('allows the same team in a different slot — three uses a season is legal', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const asPlace = await owner.put(`/leagues/${String(leagueId)}/picks/2/place`, {
      teamId: 'KC',
    });

    expect(asPlace.status).toBe(200);
  });

  it('refuses a team with no game that week', async () => {
    const { owner, leagueId } = await setup();

    // GB is on the schedule as a franchise but plays no week-1 game here.
    const response = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/win`, {
      teamId: 'GB',
    });

    expect(response.status).toBe(422);
    expect(rejectionCodes(response.body)).toContain('team_not_playing');
  });

  it("refuses a team code that isn't a team at all", async () => {
    const { owner, leagueId } = await setup();
    const response = await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'ZZZ' });
    expect(response.status).toBe(400);
  });

  it('refuses a week the season does not have', async () => {
    const { owner, leagueId } = await setup();
    const response = await owner.put(`/leagues/${String(leagueId)}/picks/19/win`, {
      teamId: 'KC',
    });
    expect(response.status).toBe(404);
  });
});

describe('kickoff locking', () => {
  it('refuses a pick once its game has started', async () => {
    const { owner, leagueId } = await setup();
    harness.setNow(new Date(THURSDAY.getTime() + 1000));

    const response = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/win`, {
      teamId: 'KC',
    });

    expect(response.status).toBe(422);
    expect(rejectionCodes(response.body)).toContain('game_locked');
  });

  it('locks each game at its own kickoff, not the whole week at once', async () => {
    const { owner, leagueId } = await setup();
    harness.setNow(new Date(THURSDAY.getTime() + 1000));

    // Thursday's game is gone, but Sunday's is still open.
    expect(
      (await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'BUF' })).status,
    ).toBe(200);

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    const thursday = board.body.games.find((game) => game.homeTeam === 'KC');
    const sunday = board.body.games.find((game) => game.homeTeam === 'BUF');
    expect(thursday?.locked).toBe(true);
    expect(sunday?.locked).toBe(false);
  });

  it('will not let a locked pick be changed or cleared', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    harness.setNow(new Date(THURSDAY.getTime() + 60_000));

    const changed = await owner.put<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/win`, {
      teamId: 'DAL',
    });
    expect(changed.status).toBe(422);
    expect(rejectionCodes(changed.body)).toContain('game_locked');

    const cleared = await owner.delete<RejectionBody>(`/leagues/${String(leagueId)}/picks/1/win`);
    expect(cleared.status).toBe(422);
    expect(rejectionCodes(cleared.body)).toContain('game_locked');
  });
});

describe('authorization', () => {
  it("writes only ever touch the caller's own picks", async () => {
    const { owner, guest, leagueId } = await setup();

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await guest.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'DAL' });

    // Same league, same week, same slot — two different members, two different picks.
    const ownerBoard = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    const guestBoard = await guest.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);

    expect(ownerBoard.body.picks[0]?.teamId).toBe('KC');
    expect(guestBoard.body.picks[0]?.teamId).toBe('DAL');
    // The board shows the caller's picks and nobody else's.
    expect(ownerBoard.body.picks).toHaveLength(1);
  });

  it('refuses a non-member entirely', async () => {
    const { leagueId } = await setup();
    const stranger = await signUp(harness.app, 'stranger@example.com');

    expect(
      (await stranger.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' })).status,
    ).toBe(404);
    expect((await stranger.delete(`/leagues/${String(leagueId)}/picks/1/win`)).status).toBe(404);
    expect((await stranger.get(`/leagues/${String(leagueId)}/board`)).status).toBe(404);
  });

  it('refuses an anonymous caller', async () => {
    const { leagueId } = await setup();
    const anonymous = new ApiClient(harness.app);

    expect(
      (await anonymous.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' })).status,
    ).toBe(401);
  });
});

describe('database backstop', () => {
  it('rejects a same-slot reuse even when the rules engine is bypassed', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    const memberId = board.body.standings.find((row) => row.displayName === 'Owner')?.memberId;
    const [kc] = await harness.db.select().from(teams).where(eq(teams.code, 'KC')).limit(1);
    const seasonId = await seasonIdFor(harness.db, 2026);

    // Writing straight to the table, as a buggy future code path would. The partial
    // unique index on (member, season, slot, team) is the last line of defence for
    // "a team may be used once per slot per season".
    await expect(
      harness.db.insert(picks).values({
        leagueMemberId: memberId ?? 0,
        seasonId,
        week: 2,
        slot: 'win',
        teamId: kc?.id ?? 0,
        source: 'app',
      }),
    ).rejects.toThrow();
  });
});

describe('team usage', () => {
  it('reports what is left in each slot', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const usage = await owner.get<{
      slots: { slot: string; used: { teamId: string; week: number }[]; remaining: string[] }[];
    }>(`/leagues/${String(leagueId)}/usage`);

    const win = usage.body.slots.find((slot) => slot.slot === 'win');
    const place = usage.body.slots.find((slot) => slot.slot === 'place');

    expect(win?.used).toEqual([{ teamId: 'KC', week: 1 }]);
    expect(win?.remaining).toHaveLength(31);
    expect(win?.remaining).not.toContain('KC');
    // Spending KC at Win leaves it available at Place and Show.
    expect(place?.remaining).toContain('KC');
  });
});
