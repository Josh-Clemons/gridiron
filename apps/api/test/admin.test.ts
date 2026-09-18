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

describe('commissioner member management', () => {
  it('renames, removes, restores and preserves a roster slot', async () => {
    const { owner, guest, leagueId, guestMemberId } = await setup();

    const renamed = await owner.patch<{
      member: { displayName: string; claimed: boolean; removedAt: string | null };
    }>(`/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}`, {
      displayName: 'Renamed Player',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.member).toEqual(
      expect.objectContaining({ displayName: 'Renamed Player', claimed: true, removedAt: null }),
    );

    await owner.put(
      `/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/picks/1/win`,
      { teamId: 'KC', reason: 'Preserve this pick while managing the roster.' },
    );
    const removed = await owner.delete<{
      member: { displayName: string; claimed: boolean; removedAt: string | null };
    }>(`/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}`);
    expect(removed.status).toBe(200);
    expect(removed.body.member).toEqual(
      expect.objectContaining({ displayName: 'Renamed Player', claimed: false }),
    );
    expect(removed.body.member.removedAt).not.toBeNull();
    expect((await guest.get(`/leagues/${String(leagueId)}`)).status).toBe(404);

    const restored = await owner.post<{
      member: { displayName: string; claimed: boolean; removedAt: string | null };
    }>(`/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.member).toEqual(
      expect.objectContaining({ displayName: 'Renamed Player', claimed: false, removedAt: null }),
    );

    const joined = await guest.post<{ memberId: number }>('/leagues/join', {
      inviteCode: (await owner.get<{ inviteCode: string }>(`/leagues/${String(leagueId)}`)).body
        .inviteCode,
      claimMemberId: guestMemberId,
    });
    expect(joined.status).toBe(200);
    expect(joined.body.memberId).toBe(guestMemberId);
  });

  it('transfers ownership only to a claimed active member', async () => {
    const { owner, guest, leagueId, guestMemberId } = await setup();

    const transferred = await owner.post<{ member: { role: string; isSelf: boolean } }>(
      `/leagues/${String(leagueId)}/admin/members/${String(guestMemberId)}/transfer-ownership`,
    );
    expect(transferred.status).toBe(200);
    expect(transferred.body.member).toEqual(
      expect.objectContaining({ role: 'owner', isSelf: false }),
    );
    expect((await owner.get(`/leagues/${String(leagueId)}/admin/members`)).status).toBe(403);

    const members = await guest.get<{
      members: { displayName: string; role: string; isSelf: boolean }[];
    }>(`/leagues/${String(leagueId)}/admin/members`);
    expect(members.status).toBe(200);
    expect(members.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Player', role: 'owner', isSelf: true }),
        expect.objectContaining({ displayName: 'Commissioner', role: 'member', isSelf: false }),
      ]),
    );
  });

  it('lists removed members for the owner and blocks member management for regular members', async () => {
    const { owner, guest, leagueId, guestMemberId } = await setup();
    const listed = await owner.get<{ members: { id: number; removedAt: string | null }[] }>(
      `/leagues/${String(leagueId)}/admin/members`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.members).toHaveLength(2);
    expect(listed.body.members.find((member) => member.id === guestMemberId)?.removedAt).toBeNull();

    const forbidden = await guest.get(`/leagues/${String(leagueId)}/admin/members`);
    expect(forbidden.status).toBe(403);

    const ownerCannotBeRemoved = await owner.delete(
      `/leagues/${String(leagueId)}/admin/members/${String((await owner.get<{ memberId: number }>(`/leagues/${String(leagueId)}`)).body.memberId)}`,
    );
    expect(ownerCannotBeRemoved.status).toBe(403);
  });
});

describe('league settings', () => {
  it('renames the league', async () => {
    const { owner, leagueId } = await setup();

    const renamed = await owner.patch<{ name: string }>(
      `/leagues/${String(leagueId)}/admin/settings`,
      { name: 'Grid Iron Classic' },
    );

    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Grid Iron Classic');
    expect((await owner.get<{ name: string }>(`/leagues/${String(leagueId)}`)).body.name).toBe(
      'Grid Iron Classic',
    );
  });

  it('regenerates the invite code and invalidates the old one', async () => {
    const { owner, leagueId } = await setup();
    const before = (await owner.get<{ inviteCode: string }>(`/leagues/${String(leagueId)}`)).body
      .inviteCode;

    const regenerated = await owner.post<{ inviteCode: string }>(
      `/leagues/${String(leagueId)}/admin/invite`,
    );
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.inviteCode).not.toBe(before);

    // The old code is dead; the new one lets a fresh account in.
    const stranger = await signUp(harness.app, 'third@example.com', 'Third');
    expect((await stranger.post('/leagues/join', { inviteCode: before })).status).toBe(404);
    expect(
      (await stranger.post('/leagues/join', { inviteCode: regenerated.body.inviteCode })).status,
    ).toBe(200);
  });

  it('archives and unarchives the league, freezing picks while archived', async () => {
    const { owner, guest, leagueId } = await setup();

    const archived = await owner.post<{ archivedAt: string | null }>(
      `/leagues/${String(leagueId)}/admin/archive`,
    );
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();

    // A player's own picks are refused while the league is archived.
    expect(
      (await guest.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' })).status,
    ).toBe(403);

    const unarchived = await owner.post<{ archivedAt: string | null }>(
      `/leagues/${String(leagueId)}/admin/unarchive`,
    );
    expect(unarchived.status).toBe(200);
    expect(unarchived.body.archivedAt).toBeNull();

    expect(
      (await guest.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' })).status,
    ).toBe(200);
  });

  it('turns a regular member away from every settings route', async () => {
    const { guest, leagueId } = await setup();

    expect(
      (await guest.patch(`/leagues/${String(leagueId)}/admin/settings`, { name: 'x' })).status,
    ).toBe(403);
    expect((await guest.post(`/leagues/${String(leagueId)}/admin/invite`)).status).toBe(403);
    expect((await guest.post(`/leagues/${String(leagueId)}/admin/archive`)).status).toBe(403);
    expect((await guest.post(`/leagues/${String(leagueId)}/admin/unarchive`)).status).toBe(403);
  });
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
