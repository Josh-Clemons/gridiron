import { games, leagueMembers, picks, seasons, teams } from '@gridiron/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ApiClient, createHarness, type Harness, insertGames, signUp } from './helpers';

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

/** Thursday night, then the Sunday slate — lock states differ inside one week. */
const THURSDAY = new Date('2026-09-10T23:20:00Z');
const SUNDAY = new Date('2026-09-13T17:00:00Z');

/** Between the two: the Thursday pick is locked, nothing else is. */
const FRIDAY = new Date('2026-09-11T12:00:00Z');

interface Entry {
  readonly memberId: number;
  readonly displayName: string;
  readonly isSelf: boolean;
  readonly rank: number;
  readonly picks: { slot: string; teamId: string; outcome: string; points: number }[];
}

interface Body {
  readonly week: number;
  readonly entries: Entry[];
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
    { home: 'KC', away: 'DEN', kickoff: THURSDAY },
    { home: 'BUF', away: 'NYJ', kickoff: SUNDAY },
    { home: 'DAL', away: 'PHI', kickoff: SUNDAY },
  ]);

  return { owner, guest, leagueId: created.body.id };
}

async function makePick(
  client: ApiClient,
  leagueId: number,
  slot: string,
  teamId: string,
): Promise<void> {
  const response = await client.put(`/leagues/${String(leagueId)}/picks/1/${slot}`, { teamId });
  expect(response.status).toBe(200);
}

const entryOf = (body: Body, name: string): Entry => {
  const entry = body.entries.find((candidate) => candidate.displayName === name);
  if (entry === undefined) throw new Error(`no entry for ${name}`);
  return entry;
};

describe('league picks', () => {
  it('shows a pick once its own game kicks off, and not before', async () => {
    const { owner, guest, leagueId } = await twoPlayerLeague();

    // Owner takes the Thursday game; guest takes only Sunday games.
    await makePick(owner, leagueId, 'win', 'KC');
    await makePick(guest, leagueId, 'win', 'BUF');
    await makePick(guest, leagueId, 'place', 'DAL');

    // Before anything kicks off, nobody is visible.
    harness.setNow(new Date('2026-09-10T12:00:00Z'));
    const early = await owner.get<Body>(`/leagues/${String(leagueId)}/league-picks?week=1`);
    expect(early.status).toBe(200);
    expect(early.body.entries).toEqual([]);

    // After Thursday's kickoff, only the Thursday pick appears.
    harness.setNow(FRIDAY);
    const board = await owner.get<Body>(`/leagues/${String(leagueId)}/league-picks?week=1`);
    expect(board.status).toBe(200);
    expect(board.body.entries).toHaveLength(1);
    const entry = entryOf(board.body, 'Owner');
    expect(entry.displayName).toBe('Owner');
    expect(entry.picks).toEqual([{ slot: 'win', teamId: 'KC', outcome: 'pending', points: 0 }]);
  });

  it('reports outcomes and points for finished games', async () => {
    const { owner, leagueId } = await twoPlayerLeague();
    await makePick(owner, leagueId, 'win', 'KC');
    await makePick(owner, leagueId, 'show', 'BUF');

    const [kcRow] = await harness.db.select().from(teams).where(eq(teams.code, 'KC'));
    if (kcRow === undefined) throw new Error('no KC team');
    await harness.db
      .update(games)
      .set({ status: 'final', winnerTeamId: kcRow.id })
      .where(and(eq(games.week, 1), eq(games.homeTeamId, kcRow.id)));

    harness.setNow(new Date('2026-09-14T12:00:00Z'));
    const board = await owner.get<Body>(`/leagues/${String(leagueId)}/league-picks?week=1`);
    const entry = entryOf(board.body, 'Owner');
    expect(entry.picks).toEqual([
      { slot: 'win', teamId: 'KC', outcome: 'win', points: 5 },
      { slot: 'show', teamId: 'BUF', outcome: 'pending', points: 0 },
    ]);
  });

  it('hides a pick whose game does not match the week, even after kickoff', async () => {
    const { owner, leagueId } = await twoPlayerLeague();

    // A stray row: a week-1 pick for a team with no week-1 game, as a drifted sync
    // or a bad import could leave behind. It must not travel just because the
    // clock has moved past some other game.
    const [denRow] = await harness.db.select().from(teams).where(eq(teams.code, 'DEN'));
    const [member] = await harness.db
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, leagueId));
    const [seasonRow] = await harness.db.select().from(seasons);
    if (denRow === undefined || member === undefined || seasonRow === undefined) {
      throw new Error('fixture row missing');
    }
    await harness.db.insert(picks).values({
      leagueMemberId: member.id,
      seasonId: seasonRow.id,
      week: 1,
      slot: 'show',
      teamId: denRow.id,
      source: 'app',
    });

    harness.setNow(new Date('2026-09-14T12:00:00Z'));
    const board = await owner.get<Body>(`/leagues/${String(leagueId)}/league-picks?week=1`);
    expect(board.status).toBe(200);
    expect(board.body.entries).toEqual([]);
  });

  it('is only for members', async () => {
    const { leagueId } = await twoPlayerLeague();
    const stranger = await signUp(harness.app, 'stranger@example.com', 'Stranger');
    const response = await stranger.get(`/leagues/${String(leagueId)}/league-picks?week=1`);
    expect(response.status).toBe(404);
  });
});
