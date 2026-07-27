import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, type Harness, insertGames, signUp } from './helpers';

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

describe('health', () => {
  it('reports ok while the database answers', async () => {
    const response = await new ApiClient(harness.app).get<{ status: string; database: boolean }>(
      '/health',
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: true });
  });
});

describe('teams', () => {
  it('serves the whole catalog, no session required', async () => {
    const response = await new ApiClient(harness.app).get<{
      teams: { code: string; name: string; shortName: string }[];
    }>('/teams');

    expect(response.status).toBe(200);
    expect(response.body.teams).toHaveLength(32);
    // Codes, not aliases: the sheet's ARZ/NOR/WAS resolve to these, never the reverse.
    expect(response.body.teams).toContainEqual({
      code: 'KC',
      name: 'Kansas City Chiefs',
      shortName: 'Chiefs',
    });
    expect(response.body.teams.map((team) => team.code)).toEqual(
      response.body.teams.map((team) => team.code).toSorted(),
    );
  });
});

describe('error envelope', () => {
  it('returns the standard shape for an unknown route', async () => {
    const response = await new ApiClient(harness.app).get<{
      error: { code: string; message: string };
    }>('/nope');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('refuses a state change from an origin we do not serve', async () => {
    const response = await harness.app.request('http://localhost/auth/login', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'a password here' }),
    });

    expect(response.status).toBe(403);
  });
});

describe('week resolution', () => {
  it('defaults to the earliest week that is not finished', async () => {
    const owner = await signUp(harness.app, 'weeks@example.com', 'Weeks');
    const created = await owner.post<{ id: number }>('/leagues', { name: 'Weeks' });
    const leagueId = created.body.id;

    await insertGames(harness.db, 2026, 1, [
      { home: 'KC', away: 'DEN', kickoff: new Date('2026-09-13T17:00:00Z'), winner: 'KC' },
    ]);
    await insertGames(harness.db, 2026, 2, [
      { home: 'BUF', away: 'NYJ', kickoff: new Date('2026-09-20T17:00:00Z') },
    ]);

    // Week 1 is final, week 2 isn't, so the app opens on week 2.
    const board = await owner.get<{ week: number }>(`/leagues/${String(leagueId)}/board`);
    expect(board.body.week).toBe(2);
  });

  it('opens on week 1 before any schedule exists', async () => {
    const owner = await signUp(harness.app, 'offseason@example.com', 'Offseason');
    const created = await owner.post<{ id: number }>('/leagues', { name: 'Offseason' });

    const board = await owner.get<{ week: number; games: unknown[] }>(
      `/leagues/${String(created.body.id)}/board`,
    );
    expect(board.body.week).toBe(1);
    expect(board.body.games).toHaveLength(0);
  });

  it('reads a past season when asked for one', async () => {
    const owner = await signUp(harness.app, 'history@example.com', 'History');
    const created = await owner.post<{ id: number }>('/leagues', { name: 'History' });

    const board = await owner.get<{ season: { year: number; weekCount: number } }>(
      `/leagues/${String(created.body.id)}/board?season=2020&week=17`,
    );

    // 2020 ran 17 weeks; nothing in the app hardcodes 18.
    expect(board.body.season).toMatchObject({ year: 2020, weekCount: 17 });

    const tooFar = await owner.get(`/leagues/${String(created.body.id)}/board?season=2020&week=18`);
    expect(tooFar.status).toBe(404);
  });
});
