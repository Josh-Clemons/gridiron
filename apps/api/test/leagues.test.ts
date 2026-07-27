import { leagueMembers, picks, teams } from '@gridiron/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, type Harness, seasonIdFor, signUp } from './helpers';

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

interface LeagueBody {
  id: number;
  name: string;
  inviteCode: string;
  memberCount: number;
  memberId: number;
  role: string;
}

async function createLeague(client: ApiClient, name = 'The Pool'): Promise<LeagueBody> {
  const response = await client.post<LeagueBody>('/leagues', { name });
  expect(response.status).toBe(201);
  return response.body;
}

/**
 * A roster slot with no account behind it, exactly as the Phase 3.5 importer will
 * create for each of the 72 names in the commissioner's workbook.
 */
async function addPlaceholder(leagueId: number, displayName: string): Promise<number> {
  const [row] = await harness.db
    .insert(leagueMembers)
    .values({ leagueId, displayName, userId: null })
    .returning({ id: leagueMembers.id });
  if (row === undefined) throw new Error('placeholder insert failed');
  return row.id;
}

describe('creating a league', () => {
  it('makes the creator the owner and issues an invite code', async () => {
    const client = await signUp(harness.app, 'owner@example.com', 'Owner');
    const league = await createLeague(client);

    expect(league.role).toBe('owner');
    expect(league.memberCount).toBe(1);
    expect(league.inviteCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/u);

    const list = await client.get<{ leagues: LeagueBody[] }>('/leagues');
    expect(list.body.leagues).toHaveLength(1);
  });

  it("hides a league from everyone who isn't in it", async () => {
    const owner = await signUp(harness.app, 'private@example.com');
    const league = await createLeague(owner);

    const stranger = await signUp(harness.app, 'stranger@example.com');
    // 404 rather than 403: confirming the league exists is itself a leak.
    expect((await stranger.get(`/leagues/${String(league.id)}`)).status).toBe(404);
    expect((await stranger.get(`/leagues/${String(league.id)}/members`)).status).toBe(404);
    expect((await stranger.get(`/leagues/${String(league.id)}/board`)).status).toBe(404);
  });
});

describe('joining by invite code', () => {
  it('adds a new member', async () => {
    const owner = await signUp(harness.app, 'host@example.com', 'Host');
    const league = await createLeague(owner);

    const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
    const joined = await guest.post<LeagueBody>('/leagues/join', { inviteCode: league.inviteCode });

    expect(joined.status).toBe(200);
    expect(joined.body.role).toBe('member');
    expect(joined.body.memberCount).toBe(2);

    const members = await owner.get<{ members: { displayName: string; claimed: boolean }[] }>(
      `/leagues/${String(league.id)}/members`,
    );
    expect(members.body.members.map((member) => member.displayName).toSorted()).toEqual([
      'Guest',
      'Host',
    ]);
  });

  it('is idempotent — joining twice changes nothing', async () => {
    const owner = await signUp(harness.app, 'twice-host@example.com');
    const league = await createLeague(owner);
    const guest = await signUp(harness.app, 'twice@example.com');

    const first = await guest.post<LeagueBody>('/leagues/join', {
      inviteCode: league.inviteCode,
    });
    const second = await guest.post<LeagueBody>('/leagues/join', {
      inviteCode: league.inviteCode,
    });

    expect(second.status).toBe(200);
    expect(second.body.memberId).toBe(first.body.memberId);
    expect(second.body.memberCount).toBe(2);
  });

  it('rejects an unknown code', async () => {
    const client = await signUp(harness.app, 'lost@example.com');
    const response = await client.post('/leagues/join', { inviteCode: 'ABCDEFGH' });
    expect(response.status).toBe(404);
  });

  it('rejects a malformed code before looking anything up', async () => {
    const client = await signUp(harness.app, 'malformed@example.com');
    const response = await client.post('/leagues/join', { inviteCode: 'nope' });
    expect(response.status).toBe(400);
  });
});

describe('claiming an imported roster slot', () => {
  it('hands the player their existing picks', async () => {
    const owner = await signUp(harness.app, 'commish@example.com', 'Commish');
    const league = await createLeague(owner, 'Grid Iron');

    const placeholderId = await addPlaceholder(league.id, 'Ty Trenary');
    const seasonId = await seasonIdFor(harness.db, 2026);
    const [team] = await harness.db.select().from(teams).where(eq(teams.code, 'KC')).limit(1);
    await harness.db.insert(picks).values({
      leagueMemberId: placeholderId,
      seasonId,
      week: 1,
      slot: 'win',
      teamId: team?.id ?? 0,
      source: 'import',
    });

    const player = await signUp(harness.app, 'ty@example.com', 'Ty');
    const preview = await player.get<{
      unclaimedMembers: { id: number; displayName: string; pickCount: number }[];
      alreadyMember: boolean;
    }>(`/leagues/preview?code=${league.inviteCode}`);

    expect(preview.status).toBe(200);
    expect(preview.body.alreadyMember).toBe(false);
    expect(preview.body.unclaimedMembers).toEqual([
      { id: placeholderId, displayName: 'Ty Trenary', pickCount: 1 },
    ]);

    const joined = await player.post<LeagueBody>('/leagues/join', {
      inviteCode: league.inviteCode,
      claimMemberId: placeholderId,
    });

    expect(joined.status).toBe(200);
    // The same roster row, so the imported history comes with it.
    expect(joined.body.memberId).toBe(placeholderId);

    const board = await player.get<{ picks: { slot: string; teamId: string; source: string }[] }>(
      `/leagues/${String(league.id)}/board?week=1`,
    );
    expect(board.body.picks).toEqual([
      expect.objectContaining({ slot: 'win', teamId: 'KC', source: 'import' }),
    ]);
  });

  it('lets only one account claim a slot', async () => {
    const owner = await signUp(harness.app, 'owner2@example.com');
    const league = await createLeague(owner);
    const placeholderId = await addPlaceholder(league.id, 'Contested Name');

    const first = await signUp(harness.app, 'first@example.com');
    const second = await signUp(harness.app, 'second@example.com');

    expect(
      (
        await first.post('/leagues/join', {
          inviteCode: league.inviteCode,
          claimMemberId: placeholderId,
        })
      ).status,
    ).toBe(200);

    const contested = await second.post('/leagues/join', {
      inviteCode: league.inviteCode,
      claimMemberId: placeholderId,
    });
    expect(contested.status).toBe(409);
  });

  it('refuses a slot belonging to a different league', async () => {
    const owner = await signUp(harness.app, 'owner3@example.com');
    const mine = await createLeague(owner, 'Mine');
    const other = await createLeague(owner, 'Other');
    const elsewhere = await addPlaceholder(other.id, 'Somebody Else');

    const player = await signUp(harness.app, 'player3@example.com');
    const response = await player.post('/leagues/join', {
      inviteCode: mine.inviteCode,
      claimMemberId: elsewhere,
    });

    expect(response.status).toBe(409);
  });
});

describe('leaving', () => {
  it('removes a member but keeps their roster slot and picks', async () => {
    const owner = await signUp(harness.app, 'stays@example.com');
    const league = await createLeague(owner);
    const guest = await signUp(harness.app, 'leaver@example.com', 'Leaver');
    await guest.post('/leagues/join', { inviteCode: league.inviteCode });

    expect((await guest.post(`/leagues/${String(league.id)}/leave`)).status).toBe(204);
    expect((await guest.get(`/leagues/${String(league.id)}`)).status).toBe(404);

    const members = await owner.get<{ members: unknown[] }>(
      `/leagues/${String(league.id)}/members`,
    );
    expect(members.body.members).toHaveLength(1);
  });

  it('will not let the last owner abandon a league with members in it', async () => {
    const owner = await signUp(harness.app, 'captain@example.com');
    const league = await createLeague(owner);
    const guest = await signUp(harness.app, 'crew@example.com');
    await guest.post('/leagues/join', { inviteCode: league.inviteCode });

    const response = await owner.post<{ error: { code: string } }>(
      `/leagues/${String(league.id)}/leave`,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });
});
