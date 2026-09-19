import { leagueMembers } from '@gridiron/schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runReminders } from '../src/domain/reminders';
import { createHarness, type ApiClient, type Harness, insertGames, signUp } from './helpers';

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

/** Week 1 of 2026. Sunday noon Central = 17:00 UTC; 11:45 Central = 16:45 UTC. */
const SUNDAY_NOON = new Date('2026-09-13T17:00:00Z');
const ELEVEN_FORTY_FIVE = new Date('2026-09-13T16:45:00Z');

async function leagueWithTwoAccounts(): Promise<{
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
    { home: 'KC', away: 'DEN', kickoff: SUNDAY_NOON },
    { home: 'BUF', away: 'NYJ', kickoff: SUNDAY_NOON },
    { home: 'SF', away: 'SEA', kickoff: SUNDAY_NOON },
  ]);

  return { owner, guest, leagueId: created.body.id };
}

/** Fill all three slots for a client, using three different games. */
async function finishPicks(client: ApiClient, leagueId: number): Promise<void> {
  await client.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });
  await client.put(`/leagues/${String(leagueId)}/picks/1/place`, { teamId: 'BUF' });
  await client.put(`/leagues/${String(leagueId)}/picks/1/show`, { teamId: 'SF' });
}

describe('pick reminders', () => {
  it('reminds members behind on picks and skips those who finished', async () => {
    const { guest, leagueId } = await leagueWithTwoAccounts();
    await finishPicks(guest, leagueId);
    harness.setNow(ELEVEN_FORTY_FIVE);

    const result = await runReminders(harness.deps);

    expect(result.sent).toBe(1);
    expect(harness.mailer.lastTo('owner@example.com')).toBeDefined();
    expect(harness.mailer.lastTo('guest@example.com')).toBeUndefined();
  });

  it('sends nothing more than 15 minutes before the Sunday kickoff', async () => {
    await leagueWithTwoAccounts();
    // 11:00 Central, an hour out.
    harness.setNow(new Date('2026-09-13T16:00:00Z'));

    const result = await runReminders(harness.deps);

    expect(result.notYet).toBe(true);
    expect(result.sent).toBe(0);
    expect(harness.mailer.sent).toHaveLength(0);
  });

  it('ignores a Thursday-night game and waits for Sunday', async () => {
    await leagueWithTwoAccounts();
    await insertGames(harness.db, 2026, 1, [
      { home: 'DAL', away: 'PHI', kickoff: new Date('2026-09-10T23:30:00Z') },
    ]);
    // Ten minutes before the Thursday kickoff — the old "next kickoff" rule would
    // fire here. The league picks against Sunday, so it must not.
    harness.setNow(new Date('2026-09-10T23:20:00Z'));

    const result = await runReminders(harness.deps);

    expect(result.notYet).toBe(true);
    expect(result.sent).toBe(0);
    expect(harness.mailer.sent).toHaveLength(0);
  });

  it('sends one reminder per member per week, no matter how often it runs', async () => {
    await leagueWithTwoAccounts();
    harness.setNow(ELEVEN_FORTY_FIVE);

    const first = await runReminders(harness.deps);
    const second = await runReminders(harness.deps);

    expect(first.sent).toBe(2);
    expect(second.sent).toBe(0);
    expect(harness.mailer.sent).toHaveLength(2);
  });

  it('skips spreadsheet players who have no account to email', async () => {
    const { owner, guest, leagueId } = await leagueWithTwoAccounts();
    await finishPicks(owner, leagueId);
    await finishPicks(guest, leagueId);
    await harness.db
      .insert(leagueMembers)
      .values({ leagueId, displayName: 'No Account', userId: null });
    harness.setNow(ELEVEN_FORTY_FIVE);

    const result = await runReminders(harness.deps);

    expect(result.sent).toBe(0);
    expect(harness.mailer.sent).toHaveLength(0);
  });
});
