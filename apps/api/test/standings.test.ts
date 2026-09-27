import { games, leagueMembers, picks, teams } from '@gridiron/schema';
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

interface BoardBody {
  picks: { slot: string; teamId: string; outcome: string; points: number }[];
  weekScore: { base: number; trifecta: number; total: number; settled: boolean };
  seasonPoints: number;
  standings: {
    memberId: number;
    displayName: string;
    weekPoints: number;
    seasonPoints: number;
    rank: number;
    isSelf: boolean;
  }[];
}

/** Mark a week's results once the picks are in, the way the Phase 3 sync will. */
async function finish(
  year: number,
  week: number,
  winners: Record<string, string | null>,
): Promise<void> {
  const seasonId = await seasonIdFor(harness.db, year);
  const rows = await harness.db.select({ id: teams.id, code: teams.code }).from(teams);
  const idOf = new Map(rows.map((row) => [row.code, row.id]));

  for (const [home, winner] of Object.entries(winners)) {
    // eslint-disable-next-line no-await-in-loop -- a handful of rows, ordering is clearer
    await harness.db
      .update(games)
      .set({
        status: 'final',
        winnerTeamId: winner === null ? null : (idOf.get(winner) ?? null),
      })
      .where(
        and(
          eq(games.seasonId, seasonId),
          eq(games.week, week),
          eq(games.homeTeamId, idOf.get(home) ?? 0),
        ),
      );
  }
}

async function twoPlayerLeague(): Promise<{
  owner: ApiClient;
  guest: ApiClient;
  leagueId: number;
}> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Owner');
  const created = await owner.post<{ id: number; inviteCode: string }>('/leagues', {
    name: 'Grid Iron',
  });
  const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
  await guest.post('/leagues/join', { inviteCode: created.body.inviteCode });

  await insertGames(harness.db, 2026, 1, [
    { home: 'KC', away: 'DEN', kickoff: SUNDAY },
    { home: 'BUF', away: 'NYJ', kickoff: SUNDAY },
    { home: 'DAL', away: 'PHI', kickoff: SUNDAY },
    { home: 'SF', away: 'SEA', kickoff: SUNDAY },
  ]);

  return { owner, guest, leagueId: created.body.id };
}

describe('scoring', () => {
  it('pays 5/3/1 plus the Trifecta bonus for a clean sweep', async () => {
    const { owner, leagueId } = await twoPlayerLeague();

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'BUF' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'DAL' });

    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: 'SF' });

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.weekScore).toEqual({
      week: 1,
      base: 9,
      trifecta: 2,
      total: 11,
      settled: true,
    });
    expect(board.body.seasonPoints).toBe(11);
  });

  it('scores a tie as a loss and withholds the bonus', async () => {
    const { owner, leagueId } = await twoPlayerLeague();

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'BUF' });
    await owner.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'SF' });

    // SF/SEA ends level. Rule 7: a tie counts as a loss for both sides.
    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: null });

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.weekScore.base).toBe(8);
    expect(board.body.weekScore.trifecta).toBe(0);
    expect(board.body.weekScore.total).toBe(8);
    expect(board.body.picks.find((pick) => pick.slot === 'show')?.outcome).toBe('loss');
  });

  it('leaves an unplayed week pending and scores an empty slot as zero', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=1`);
    expect(board.body.weekScore.settled).toBe(false);
    expect(board.body.weekScore.total).toBe(0);
    expect(board.body.picks[0]?.outcome).toBe('pending');
  });
});

describe('standings', () => {
  it('ranks members by season points, sharing a rank on a tie', async () => {
    const { owner, guest, leagueId } = await twoPlayerLeague();

    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await guest.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'DEN' });
    await guest.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'NYJ' });

    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: 'SF' });

    const response = await owner.get<{
      rows: { displayName: string; seasonPoints: number; weekPoints: number; rank: number }[];
    }>(`/leagues/${String(leagueId)}/standings?week=1`);

    expect(response.body.rows).toEqual([
      expect.objectContaining({ displayName: 'Owner', seasonPoints: 5, weekPoints: 5, rank: 1 }),
      expect.objectContaining({ displayName: 'Guest', seasonPoints: 0, weekPoints: 0, rank: 2 }),
    ]);
  });

  it('includes unclaimed imported members', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await harness.db
      .insert(leagueMembers)
      .values({ leagueId, displayName: 'Imported Player', userId: null });

    const response = await owner.get<{ rows: { displayName: string; claimed: boolean }[] }>(
      `/leagues/${String(leagueId)}/standings?week=1`,
    );

    const imported = response.body.rows.find((row) => row.displayName === 'Imported Player');
    expect(imported?.claimed).toBe(false);
  });
});

describe('standings CSV', () => {
  it('exports ranked season totals with per-week picks and points', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: 'SF' });

    const csv = await owner.getRaw(`/leagues/${String(leagueId)}/standings.csv`);
    expect(csv.status).toBe(200);
    expect(csv.contentType).toContain('text/csv');

    const text = new TextDecoder().decode(csv.body);
    const [header, ownerRow, guestRow] = text.trimEnd().split('\r\n');

    // 18 weeks × (5, 3, 1 pick columns + one points column) after the three fixed ones.
    const columns = header?.split(',');
    expect(columns?.slice(0, 3)).toEqual(['Rank', 'Player', 'Season Points']);
    expect(columns?.slice(3, 7)).toEqual(['5', '3', '1', 'W1']);
    expect(columns?.slice(7, 11)).toEqual(['5', '3', '1', 'W2']);
    expect(columns).toHaveLength(3 + 18 * 4);
    expect(columns?.at(-1)).toBe('W18');

    // No game has kicked off yet, so every pick column is blank; the scored points
    // still appear. Owner took KC (5 points) in week 1, guest took nothing.
    expect(ownerRow?.split(',')).toEqual([
      '1',
      'Owner',
      '5',
      '',
      '',
      '',
      '5',
      ...Array.from({ length: 17 }, () => ['', '', '', '0']).flat(),
    ]);
    expect(guestRow?.split(',')).toEqual([
      '2',
      'Guest',
      '0',
      ...Array.from({ length: 18 }, () => ['', '', '', '0']).flat(),
    ]);
  });

  it("includes each member's locked picks once their games have kicked off", async () => {
    const { owner, guest, leagueId } = await twoPlayerLeague();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
    await guest.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'NYJ' });
    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: 'SF' });

    // Before kickoff the pick columns are blank — the totals are all that travel.
    const early = new TextDecoder().decode(
      (await owner.getRaw(`/leagues/${String(leagueId)}/standings.csv`)).body,
    );
    expect(early.trimEnd().split('\r\n')[1]?.split(',')[3]).toBe('');

    // After kickoff, the picks lock and appear under 5/3/1.
    harness.setNow(new Date('2026-09-14T12:00:00Z'));
    const text = new TextDecoder().decode(
      (await owner.getRaw(`/leagues/${String(leagueId)}/standings.csv`)).body,
    );
    const rows = text.trimEnd().split('\r\n');
    const ownerRow = rows.find((row) => row.startsWith('1,Owner'));
    const guestRow = rows.find((row) => row.startsWith('2,Guest'));

    // Win (5) in week 1 for the owner; Place (3) for the guest.
    expect(ownerRow?.split(',')[3]).toBe('KC');
    expect(ownerRow?.split(',')[6]).toBe('5');
    expect(guestRow?.split(',')[4]).toBe('NYJ');
  });

  it('quotes a roster label that contains a comma', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await harness.db
      .insert(leagueMembers)
      .values({ leagueId, displayName: 'Daly, Twins', userId: null });

    const csv = await owner.getRaw(`/leagues/${String(leagueId)}/standings.csv`);
    const text = new TextDecoder().decode(csv.body);
    expect(text).toContain('"Daly, Twins"');
  });
});

describe('offseason', () => {
  it('reports the season incomplete while weeks remain unplayed', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    const board = await owner.get<{ seasonComplete: boolean }>(
      `/leagues/${String(leagueId)}/board?week=1`,
    );
    expect(board.body.seasonComplete).toBe(false);
  });

  it('reports the season complete once every week is final', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await finish(2026, 1, { KC: 'KC', BUF: 'BUF', DAL: 'DAL', SF: 'SF' });

    // One final game settles each remaining week — no need for a full 16-game slate.
    for (let week = 2; week <= 18; week += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential inserts, one per week
      await insertGames(harness.db, 2026, week, [
        {
          home: 'KC',
          away: 'DEN',
          kickoff: new Date(SUNDAY.getTime() + week * 86_400_000),
          winner: 'KC',
        },
      ]);
    }

    const board = await owner.get<{ seasonComplete: boolean }>(
      `/leagues/${String(leagueId)}/board?week=1`,
    );
    expect(board.body.seasonComplete).toBe(true);
  });
});

describe('a full-size league', () => {
  it("serves a 72-member board well under 30 KB and without anyone else's picks", async () => {
    const owner = await signUp(harness.app, 'commish@example.com', 'Commish');
    const created = await owner.post<{ id: number }>('/leagues', { name: 'The Real League' });
    const leagueId = created.body.id;
    const seasonId = await seasonIdFor(harness.db, 2026);

    const teamRows = await harness.db.select({ id: teams.id, code: teams.code }).from(teams);
    const codes = teamRows.map((row) => row.code).toSorted();
    const idOf = new Map(teamRows.map((row) => [row.code, row.id]));

    // Four weeks of real schedule: 16 games a week, every team playing once.
    const weeks = [1, 2, 3, 4];
    for (const week of weeks) {
      const pairs = Array.from({ length: 16 }, (_, index) => ({
        home: codes[index * 2] ?? 'KC',
        away: codes[index * 2 + 1] ?? 'DEN',
        kickoff: new Date(SUNDAY.getTime() + (week - 1) * 7 * 86_400_000),
        winner: codes[index * 2] ?? 'KC',
      }));
      // eslint-disable-next-line no-await-in-loop -- sequential inserts keep the data readable
      await insertGames(harness.db, 2026, week, pairs);
    }

    // 71 imported roster slots, as the workbook would produce, plus the owner.
    const placeholders = await harness.db
      .insert(leagueMembers)
      .values(
        Array.from({ length: 71 }, (_, index) => ({
          leagueId,
          displayName: `Player ${String(index + 1).padStart(2, '0')}`,
          userId: null,
        })),
      )
      .returning({ id: leagueMembers.id });

    // Three picks each per week. Slot assignment rotates by week, so no team is ever
    // reused in the same slot — the same constraint a real season lives under.
    const rows = placeholders.flatMap((member, memberIndex) =>
      weeks.flatMap((week) =>
        (['win', 'place', 'show'] as const).map((slot, slotIndex) => {
          const offset = (memberIndex + week * 3 + slotIndex * 11) % 32;
          return {
            leagueMemberId: member.id,
            seasonId,
            week,
            slot,
            teamId: idOf.get(codes[offset] ?? 'KC') ?? 0,
            source: 'import' as const,
          };
        }),
      ),
    );
    await harness.db.insert(picks).values(rows);

    const board = await owner.get<BoardBody>(`/leagues/${String(leagueId)}/board?week=4`);

    expect(board.status).toBe(200);
    expect(board.body.standings).toHaveLength(72);
    // Only the caller's own picks travel; everyone else is integers.
    expect(board.body.picks).toHaveLength(0);
    expect(JSON.stringify(board.body).length).toBeLessThan(30_000);

    const scored = board.body.standings.filter((row) => row.seasonPoints > 0);
    expect(scored.length).toBeGreaterThan(0);
  });
});
