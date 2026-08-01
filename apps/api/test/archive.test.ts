import { champions, games, picks, teams } from '@gridiron/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ApiClient,
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

beforeEach(async () => {
  await harness.reset();
});

const SUNDAY = new Date('2026-09-13T17:00:00Z');

interface ChampionsBody {
  pools: {
    pool: string;
    years: {
      year: number;
      champions: { displayName: string; memberId: number | null; totalPoints: number | null }[];
    }[];
  }[];
}

interface SeasonsBody {
  seasons: { year: number; weekCount: number; hasGames: boolean; hasPicks: boolean }[];
}

interface HistoryBody {
  season: { year: number; weekCount: number };
  weeks: { week: number; settled: boolean }[];
  rows: {
    memberId: number;
    displayName: string;
    rank: number;
    seasonPoints: number;
    points: number[];
    isSelf: boolean;
    claimed: boolean;
  }[];
}

async function league(): Promise<{ owner: ApiClient; leagueId: number; inviteCode: string }> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Owner');
  const created = await owner.post<{ id: number; inviteCode: string }>('/leagues', {
    name: 'Grid Iron',
  });
  return { owner, leagueId: created.body.id, inviteCode: created.body.inviteCode };
}

/** Mark a week's results, the way the sync does once the games are played. */
async function finish(year: number, week: number, winners: Record<string, string>): Promise<void> {
  const seasonId = await seasonIdFor(harness.db, year);
  const rows = await harness.db.select({ id: teams.id, code: teams.code }).from(teams);
  const idOf = new Map(rows.map((row) => [row.code, row.id]));

  for (const [home, winner] of Object.entries(winners)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of rows, ordering is clearer
    await harness.db
      .update(games)
      .set({ status: 'final', winnerTeamId: idOf.get(winner) ?? null })
      .where(
        and(
          eq(games.seasonId, seasonId),
          eq(games.week, week),
          eq(games.homeTeamId, idOf.get(home) ?? 0),
        ),
      );
  }
}

describe('champions', () => {
  /**
   * The honours board as the workbook actually records it: a 2007 winner nobody in the
   * app has ever been, a year that tied, a playoff pool that starts five years later,
   * and 2018, when the playoff pool played no game at all.
   */
  async function seedHonours(leagueId: number, memberId: number | null = null): Promise<void> {
    await harness.db.insert(champions).values([
      { leagueId, year: 2007, pool: 'regular', displayName: 'Old Timer', totalPoints: null },
      { leagueId, year: 2022, pool: 'regular', displayName: 'Meaghan Olender', totalPoints: 146 },
      { leagueId, year: 2022, pool: 'regular', displayName: 'Kevin Fournier', totalPoints: 146 },
      { leagueId, year: 2009, pool: 'regular', displayName: 'Ralph Ramirez', memberId },
      { leagueId, year: 2012, pool: 'playoff', displayName: 'Playoff One', totalPoints: 20 },
      { leagueId, year: 2017, pool: 'playoff', displayName: 'Playoff Two', totalPoints: 22 },
      { leagueId, year: 2019, pool: 'playoff', displayName: 'Playoff Three', totalPoints: 24 },
    ]);
  }

  it('groups by pool and lists every year newest first', async () => {
    const { owner, leagueId } = await league();
    const me = await owner.get<{ members: { id: number; isSelf: boolean }[] }>(
      `/leagues/${String(leagueId)}/members`,
    );
    const memberId = me.body.members.find((member) => member.isSelf)?.id ?? 0;
    await seedHonours(leagueId, memberId);

    const response = await owner.get<ChampionsBody>(`/leagues/${String(leagueId)}/champions`);

    expect(response.status).toBe(200);
    expect(response.body.pools.map((entry) => entry.pool)).toEqual(['regular', 'playoff']);

    const regular = response.body.pools[0];
    expect(regular?.years[0]?.year).toBe(2022);
    expect(regular?.years.at(-1)?.year).toBe(2007);
    // 2007 through 2022 inclusive, with no year missing from the middle.
    expect(regular?.years).toHaveLength(16);
  });

  it('keeps both names when a year ties, in name order', async () => {
    const { owner, leagueId } = await league();
    await seedHonours(leagueId);

    const response = await owner.get<ChampionsBody>(`/leagues/${String(leagueId)}/champions`);
    const tied = response.body.pools[0]?.years.find((entry) => entry.year === 2022);

    expect(tied?.champions.map((champion) => champion.displayName)).toEqual([
      'Kevin Fournier',
      'Meaghan Olender',
    ]);
    expect(tied?.champions.every((champion) => champion.totalPoints === 146)).toBe(true);
  });

  it('renders a year nobody won as an empty entry rather than skipping it', async () => {
    const { owner, leagueId } = await league();
    await seedHonours(leagueId);

    const response = await owner.get<ChampionsBody>(`/leagues/${String(leagueId)}/champions`);
    const playoff = response.body.pools.find((entry) => entry.pool === 'playoff');

    // The playoff pool ran 2012–2019 here, and 2018 had no game.
    expect(playoff?.years.map((entry) => entry.year)).toEqual([
      2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012,
    ]);
    expect(playoff?.years.find((entry) => entry.year === 2018)?.champions).toEqual([]);
    expect(playoff?.years.find((entry) => entry.year === 2019)?.champions).toHaveLength(1);
  });

  it('links a champion who is still on the roster and leaves the rest unlinked', async () => {
    const { owner, leagueId } = await league();
    const me = await owner.get<{ members: { id: number; isSelf: boolean }[] }>(
      `/leagues/${String(leagueId)}/members`,
    );
    const memberId = me.body.members.find((member) => member.isSelf)?.id ?? 0;
    await seedHonours(leagueId, memberId);

    const response = await owner.get<ChampionsBody>(`/leagues/${String(leagueId)}/champions`);
    const years = response.body.pools[0]?.years ?? [];

    expect(years.find((entry) => entry.year === 2009)?.champions[0]?.memberId).toBe(memberId);
    expect(years.find((entry) => entry.year === 2007)?.champions[0]).toEqual({
      year: 2007,
      pool: 'regular',
      displayName: 'Old Timer',
      memberId: null,
      totalPoints: null,
      note: null,
    });
  });

  it('returns no pools at all for a league that has imported nothing', async () => {
    const { owner, leagueId } = await league();
    const response = await owner.get<ChampionsBody>(`/leagues/${String(leagueId)}/champions`);
    expect(response.body.pools).toEqual([]);
  });

  it('is not readable by someone outside the league', async () => {
    const { leagueId } = await league();
    const stranger = await signUp(harness.app, 'stranger@example.com', 'Stranger');

    const response = await stranger.get(`/leagues/${String(leagueId)}/champions`);
    expect(response.status).toBe(404);
  });
});

describe('seasons', () => {
  it('offers seasons with a schedule or picks, and hides the rest', async () => {
    const { owner, leagueId } = await league();
    await insertGames(harness.db, 2026, 1, [{ home: 'KC', away: 'DEN', kickoff: SUNDAY }]);

    // An imported season with picks but no schedule loaded: still worth offering, since
    // the picks themselves are the history.
    const seasonId = await seasonIdFor(harness.db, 2020);
    const [team] = await harness.db.select({ id: teams.id }).from(teams).limit(1);
    const members = await owner.get<{ members: { id: number; isSelf: boolean }[] }>(
      `/leagues/${String(leagueId)}/members`,
    );
    await harness.db.insert(picks).values({
      leagueMemberId: members.body.members.find((member) => member.isSelf)?.id ?? 0,
      seasonId,
      week: 1,
      slot: 'win',
      teamId: team?.id ?? 0,
      source: 'import',
    });

    const response = await owner.get<SeasonsBody>(`/leagues/${String(leagueId)}/seasons`);

    expect(response.body.seasons.map((season) => season.year)).toEqual([2026, 2020]);
    expect(response.body.seasons[0]).toMatchObject({ hasGames: true, hasPicks: false });
    expect(response.body.seasons[1]).toMatchObject({
      hasGames: false,
      hasPicks: true,
      weekCount: 17,
    });
  });

  it("does not count another league's picks as this league's history", async () => {
    const { owner, leagueId } = await league();
    const other = await signUp(harness.app, 'other@example.com', 'Other');
    const created = await other.post<{ id: number; inviteCode: string }>('/leagues', {
      name: 'Other League',
    });

    const seasonId = await seasonIdFor(harness.db, 2023);
    const [team] = await harness.db.select({ id: teams.id }).from(teams).limit(1);
    const theirMembers = await other.get<{ members: { id: number; isSelf: boolean }[] }>(
      `/leagues/${String(created.body.id)}/members`,
    );
    await harness.db.insert(picks).values({
      leagueMemberId: theirMembers.body.members.find((member) => member.isSelf)?.id ?? 0,
      seasonId,
      week: 1,
      slot: 'win',
      teamId: team?.id ?? 0,
      source: 'import',
    });

    const response = await owner.get<SeasonsBody>(`/leagues/${String(leagueId)}/seasons`);
    expect(response.body.seasons.map((season) => season.year)).not.toContain(2023);
  });
});

describe('season history', () => {
  async function playedLeague(): Promise<{ owner: ApiClient; guest: ApiClient; leagueId: number }> {
    const { owner, leagueId, inviteCode } = await league();
    const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
    await guest.post('/leagues/join', { inviteCode });

    await insertGames(harness.db, 2026, 1, [
      { home: 'KC', away: 'DEN', kickoff: SUNDAY },
      { home: 'BUF', away: 'NYJ', kickoff: SUNDAY },
      { home: 'DAL', away: 'PHI', kickoff: SUNDAY },
    ]);
    await insertGames(harness.db, 2026, 2, [
      { home: 'SF', away: 'SEA', kickoff: new Date('2026-09-20T17:00:00Z') },
    ]);

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'BUF' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'DAL' });
    await guest.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'DEN' });

    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL' });
    return { owner, guest, leagueId };
  }

  it('returns a points cell for every week of the season, in order', async () => {
    const { owner, leagueId } = await playedLeague();
    const response = await owner.get<HistoryBody>(`/leagues/${String(leagueId)}/history`);

    expect(response.status).toBe(200);
    expect(response.body.season.weekCount).toBe(18);
    expect(response.body.weeks.map((week) => week.week)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    for (const row of response.body.rows) {
      expect(row.points).toHaveLength(18);
    }

    const mine = response.body.rows.find((row) => row.isSelf);
    // A clean sweep: 5 + 3 + 1 plus the Trifecta bonus.
    expect(mine?.points[0]).toBe(11);
    expect(mine?.points[1]).toBe(0);
    expect(mine?.seasonPoints).toBe(11);
  });

  it('marks a week settled only when every one of its games is final', async () => {
    const { owner, leagueId } = await playedLeague();
    const response = await owner.get<HistoryBody>(`/leagues/${String(leagueId)}/history`);

    expect(response.body.weeks[0]).toEqual({ week: 1, settled: true });
    // Week 2 is scheduled but unplayed; week 3 has no games at all. Neither is settled,
    // which is what tells a zero row apart from a week that hasn't happened.
    expect(response.body.weeks[1]).toEqual({ week: 2, settled: false });
    expect(response.body.weeks[2]).toEqual({ week: 3, settled: false });
  });

  it('agrees with the standings on totals and order', async () => {
    const { owner, leagueId } = await playedLeague();

    const history = await owner.get<HistoryBody>(`/leagues/${String(leagueId)}/history`);
    const standings = await owner.get<{
      rows: { memberId: number; seasonPoints: number; rank: number }[];
    }>(`/leagues/${String(leagueId)}/standings?week=1`);

    expect(history.body.rows.map((row) => [row.memberId, row.seasonPoints, row.rank])).toEqual(
      standings.body.rows.map((row) => [row.memberId, row.seasonPoints, row.rank]),
    );
    expect(history.body.rows.map((row) => row.points.reduce((sum, week) => sum + week, 0))).toEqual(
      standings.body.rows.map((row) => row.seasonPoints),
    );
  });

  it('reads a past season through ?season=', async () => {
    const { owner, leagueId } = await playedLeague();

    const response = await owner.get<HistoryBody>(
      `/leagues/${String(leagueId)}/history?season=2020`,
    );

    expect(response.body.season.year).toBe(2020);
    // 2020 is the 17-week season — the one that proves nothing hardcodes 18.
    expect(response.body.weeks).toHaveLength(17);
    expect(response.body.rows.every((row) => row.seasonPoints === 0)).toBe(true);
  });

  it('is not readable by someone outside the league', async () => {
    const { leagueId } = await playedLeague();
    const stranger = await signUp(harness.app, 'stranger@example.com', 'Stranger');

    const response = await stranger.get(`/leagues/${String(leagueId)}/history`);
    expect(response.status).toBe(404);
  });
});
