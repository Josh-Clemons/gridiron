import { games } from '@gridiron/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EspnClient, EspnGame } from '../src/sync/espn';
import { EspnError } from '../src/sync/espn';
import { syncWeeks } from '../src/sync/games';
import { createHarness, type Harness, seasonIdFor, signUp } from './helpers';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

const KICKOFF = new Date('2026-09-13T17:00:00Z');

/**
 * A stand-in for ESPN.
 *
 * The parser is tested against recorded payloads; this exercises what we do with the
 * result. Keeping the network out means these tests run the same offline, in CI, and
 * on a day the real endpoint is having problems.
 */
function stubClient(weeks: Record<number, EspnGame[]>): EspnClient {
  return {
    fetchWeek(_year: number, week: number): Promise<EspnGame[]> {
      const found = weeks[week];
      if (found === undefined) {
        return Promise.reject(new EspnError(`stub has no week ${String(week)}`));
      }
      return Promise.resolve(found);
    },
  };
}

function game(overrides: Partial<EspnGame> & Pick<EspnGame, 'externalId'>): EspnGame {
  return {
    week: 1,
    homeTeam: 'KC',
    awayTeam: 'DEN',
    kickoff: KICKOFF,
    status: 'scheduled',
    winner: null,
    ...overrides,
  };
}

async function storedGames(year: number, week: number) {
  const seasonId = await seasonIdFor(harness.db, year);
  return harness.db
    .select()
    .from(games)
    .where(and(eq(games.seasonId, seasonId), eq(games.week, week)));
}

describe('schedule sync', () => {
  it('loads a week and is a no-op when re-run', async () => {
    const client = stubClient({
      1: [
        game({ externalId: 'e1', homeTeam: 'KC', awayTeam: 'DEN' }),
        game({ externalId: 'e2', homeTeam: 'BUF', awayTeam: 'NYJ' }),
      ],
    });

    const first = await syncWeeks(harness.deps, client, 2026, [1]);
    expect(first).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });

    const second = await syncWeeks(harness.deps, client, 2026, [1]);
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(await storedGames(2026, 1)).toHaveLength(2);
  });

  it('moves a kickoff that ESPN has changed', async () => {
    const before = stubClient({ 1: [game({ externalId: 'e1' })] });
    await syncWeeks(harness.deps, before, 2026, [1]);

    const flexed = new Date('2026-09-14T00:20:00Z');
    const after = stubClient({ 1: [game({ externalId: 'e1', kickoff: flexed })] });
    const result = await syncWeeks(harness.deps, after, 2026, [1]);

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const [row] = await storedGames(2026, 1);
    expect(row?.kickoff.toISOString()).toBe(flexed.toISOString());
  });

  it('resolves ESPN codes through the alias table', async () => {
    const client = stubClient({
      1: [game({ externalId: 'e1', homeTeam: 'ARI', awayTeam: 'NO' })],
    });

    await syncWeeks(harness.deps, client, 2026, [1]);
    const [row] = await storedGames(2026, 1);
    expect(row).toBeDefined();
  });

  it('refuses an unknown team code instead of guessing', async () => {
    const client = stubClient({ 1: [game({ externalId: 'e1', homeTeam: 'XYZ' })] });

    await expect(syncWeeks(harness.deps, client, 2026, [1])).rejects.toThrow(/unknown team code/u);
    // Nothing partially written — the whole week rolls back.
    expect(await storedGames(2026, 1)).toHaveLength(0);
  });

  it('refuses a season that has not been seeded', async () => {
    const client = stubClient({ 1: [game({ externalId: 'e1' })] });
    await expect(syncWeeks(harness.deps, client, 2019, [1])).rejects.toThrow(/no season 2019/u);
  });

  it('reports a stored game that vanished from the feed without deleting it', async () => {
    const both = stubClient({
      1: [game({ externalId: 'e1' }), game({ externalId: 'e2', homeTeam: 'BUF', awayTeam: 'NYJ' })],
    });
    await syncWeeks(harness.deps, both, 2026, [1]);

    const onlyOne = stubClient({ 1: [game({ externalId: 'e1' })] });
    const result = await syncWeeks(harness.deps, onlyOne, 2026, [1]);

    // A postponement must not silently void the picks made on that game.
    expect(result.orphaned).toBe(1);
    expect(await storedGames(2026, 1)).toHaveLength(2);
  });
});

describe('result sync', () => {
  it('scores picks with no separate rescore step', async () => {
    const scheduled = stubClient({
      1: [
        game({ externalId: 'e1', homeTeam: 'KC', awayTeam: 'DEN' }),
        game({ externalId: 'e2', homeTeam: 'BUF', awayTeam: 'NYJ' }),
        game({ externalId: 'e3', homeTeam: 'DAL', awayTeam: 'PHI' }),
      ],
    });
    await syncWeeks(harness.deps, scheduled, 2026, [1]);

    const owner = await signUp(harness.app, 'player@example.com', 'Player');
    const league = await owner.post<{ id: number }>('/leagues', { name: 'Sync League' });
    const leagueId = league.body.id;

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'BUF' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'DAL' });

    const before = await owner.get<{ weekScore: { total: number; settled: boolean } }>(
      `/leagues/${String(leagueId)}/board?week=1`,
    );
    expect(before.body.weekScore).toMatchObject({ total: 0, settled: false });

    const finals = stubClient({
      1: [
        game({ externalId: 'e1', homeTeam: 'KC', awayTeam: 'DEN', status: 'final', winner: 'KC' }),
        game({
          externalId: 'e2',
          homeTeam: 'BUF',
          awayTeam: 'NYJ',
          status: 'final',
          winner: 'BUF',
        }),
        game({
          externalId: 'e3',
          homeTeam: 'DAL',
          awayTeam: 'PHI',
          status: 'final',
          winner: 'DAL',
        }),
      ],
    });
    const result = await syncWeeks(harness.deps, finals, 2026, [1]);
    expect(result.updated).toBe(3);

    // Standings are derived on read, so writing the results *is* the rescore.
    const after = await owner.get<{
      weekScore: { base: number; trifecta: number; total: number; settled: boolean };
      seasonPoints: number;
    }>(`/leagues/${String(leagueId)}/board?week=1`);

    expect(after.body.weekScore).toMatchObject({ base: 9, trifecta: 2, total: 11, settled: true });
    expect(after.body.seasonPoints).toBe(11);
  });

  it('scores a synced tie as a loss', async () => {
    const scheduled = stubClient({
      1: [game({ externalId: 'e1', homeTeam: 'SF', awayTeam: 'SEA' })],
    });
    await syncWeeks(harness.deps, scheduled, 2026, [1]);

    const owner = await signUp(harness.app, 'tie@example.com', 'Tie');
    const league = await owner.post<{ id: number }>('/leagues', { name: 'Tie League' });
    await owner.put(`/leagues/${String(league.body.id)}/picks/1/win`, { teamId: 'SF' });

    const tied = stubClient({
      1: [
        game({ externalId: 'e1', homeTeam: 'SF', awayTeam: 'SEA', status: 'final', winner: null }),
      ],
    });
    await syncWeeks(harness.deps, tied, 2026, [1]);

    const board = await owner.get<{
      picks: { outcome: string; points: number }[];
      weekScore: { total: number; settled: boolean };
    }>(`/leagues/${String(league.body.id)}/board?week=1`);

    expect(board.body.picks[0]).toMatchObject({ outcome: 'loss', points: 0 });
    expect(board.body.weekScore).toMatchObject({ total: 0, settled: true });
  });

  it('corrects a result that ESPN revises', async () => {
    const wrong = stubClient({
      1: [game({ externalId: 'e1', status: 'final', winner: 'DEN' })],
    });
    await syncWeeks(harness.deps, wrong, 2026, [1]);

    const right = stubClient({
      1: [game({ externalId: 'e1', status: 'final', winner: 'KC' })],
    });
    const result = await syncWeeks(harness.deps, right, 2026, [1]);

    // Nothing accumulates a running total, so a corrected result just corrects.
    expect(result.updated).toBe(1);
    const [row] = await storedGames(2026, 1);
    expect(row?.winnerTeamId).not.toBeNull();
  });
});
