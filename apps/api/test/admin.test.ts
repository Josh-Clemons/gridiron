import { leagueMembers } from '@gridiron/schema';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, insertGames, type Harness, signUp } from './helpers';

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

async function setup(): Promise<{
  owner: ApiClient;
  guest: ApiClient;
  leagueId: number;
  guestMemberId: number;
}> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Commissioner');
  const created = await owner.post<{ id: number; inviteCode: string }>('/leagues', {
    name: 'Grid Iron',
  });
  const guest = await signUp(harness.app, 'guest@example.com', 'Player');
  await guest.post('/leagues/join', { inviteCode: created.body.inviteCode });

  const [member] = await harness.db
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, created.body.id))
    .orderBy(desc(leagueMembers.id));
  if (member === undefined) throw new Error('guest member was not created');

  await insertGames(harness.db, 2026, 1, [
    { home: 'KC', away: 'DEN', kickoff: new Date('2026-09-10T23:20:00Z') },
    { home: 'BUF', away: 'NYJ', kickoff: new Date('2026-09-13T17:00:00Z') },
    { home: 'DAL', away: 'PHI', kickoff: new Date('2026-09-13T17:00:00Z') },
  ]);

  return { owner, guest, leagueId: created.body.id, guestMemberId: member.id };
}

beforeEach(async () => {
  await harness.reset();
});

describe('commissioner pick corrections', () => {
  it('writes a correction after kickoff and exposes the audit log', async () => {
    const { owner, leagueId, guestMemberId } = await setup();

    const response = await owner.put<{
      pick: { teamId: string; source: string };
      correction: {
        actorName: string;
        targetName: string;
        fromTeamId: string | null;
        toTeamId: string;
        reason: string;
      };
    }>(`/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/picks/1/win`, {
      teamId: 'KC',
      reason: 'The player texted the commissioner after the deadline.',
    });

    expect(response.status).toBe(200);
    expect(response.body.pick).toEqual(
      expect.objectContaining({ teamId: 'KC', source: 'correction' }),
    );
    expect(response.body.correction).toEqual(
      expect.objectContaining({
        actorName: 'Commissioner',
        targetName: 'Player',
        fromTeamId: null,
        toTeamId: 'KC',
        reason: 'The player texted the commissioner after the deadline.',
      }),
    );

    const log = await owner.get<{ corrections: { toTeamId: string; reason: string }[] }>(
      `/leagues/${String(leagueId)}/admin/corrections`,
    );
    expect(log.status).toBe(200);
    expect(log.body.corrections).toHaveLength(1);
    expect(log.body.corrections[0]).toEqual(
      expect.objectContaining({
        toTeamId: 'KC',
        reason: 'The player texted the commissioner after the deadline.',
      }),
    );
  });

  it('allows the owner to clear a pick and records the old team', async () => {
    const { owner, leagueId, guestMemberId } = await setup();
    await owner.put(
      `/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/picks/1/win`,
      {
        teamId: 'KC',
        reason: 'Initial correction.',
      },
    );

    const response = await owner.put<{
      pick?: unknown;
      correction: { fromTeamId: string; toTeamId: string | null };
    }>(`/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/picks/1/win`, {
      teamId: null,
      reason: 'The player withdrew the selection.',
    });

    expect(response.status).toBe(200);
    expect(response.body.pick).toBeUndefined();
    expect(response.body.correction).toEqual(
      expect.objectContaining({ fromTeamId: 'KC', toTeamId: null }),
    );
  });

  it('rejects a regular member and does not allow cross-league targets', async () => {
    const { owner, guest, leagueId, guestMemberId } = await setup();

    const forbidden = await guest.put(
      `/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/picks/1/win`,
      { teamId: 'KC', reason: 'Not allowed.' },
    );
    expect(forbidden.status).toBe(403);

    const invalid = await owner.put(
      `/leagues/${String(leagueId)}/admin/members/999999/picks/1/win`,
      { teamId: 'KC', reason: 'No such member.' },
    );
    expect(invalid.status).toBe(404);
  });
});
