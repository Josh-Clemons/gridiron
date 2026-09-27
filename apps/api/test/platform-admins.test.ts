import { users } from '@gridiron/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, type Harness, signUp } from './helpers';

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

/**
 * The platform admin flag: `users.is_admin` gives owner powers in any league the
 * admin belongs to. It never bypasses the membership gate — an admin who never
 * joined is told the league does not exist, exactly like anyone else.
 */
describe('platform admins', () => {
  /** An owner's league, two joined members, and one member's account flag flipped to admin. */
  async function adminSetup(): Promise<{
    admin: ApiClient;
    guest: ApiClient;
    leagueId: number;
  }> {
    const owner = await signUp(harness.app, 'owner@example.com', 'Commissioner');
    const created = await owner.post<{ id: number; inviteCode: string }>('/leagues', {
      name: 'Grid Iron',
    });
    const admin = await signUp(harness.app, 'admin@example.com', 'Admin');
    await admin.post('/leagues/join', { inviteCode: created.body.inviteCode });
    const guest = await signUp(harness.app, 'guest@example.com', 'Player');
    await guest.post('/leagues/join', { inviteCode: created.body.inviteCode });

    // Only the account flag changes — the admin stays a plain member of the league.
    // The flag is read per request, so this takes effect without re-logging in.
    await harness.db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.email, 'admin@example.com'));

    return { admin, guest, leagueId: created.body.id };
  }

  it('gives an admin owner powers in a league they belong to', async () => {
    const { admin, leagueId } = await adminSetup();

    // The membership still reads as a plain member; only the powers change.
    const membership = await admin.get<{ role: string }>(`/leagues/${String(leagueId)}`);
    expect(membership.status).toBe(200);
    expect(membership.body.role).toBe('member');

    // Both gates of an admin route: the owner tools answer, read and write.
    const members = await admin.get(`/leagues/${String(leagueId)}/admin/members`);
    expect(members.status).toBe(200);

    const renamed = await admin.patch(`/leagues/${String(leagueId)}/admin/settings`, {
      name: 'Renamed by Admin',
    });
    expect(renamed.status).toBe(200);
  });

  it('still requires membership: an admin who never joined is told nothing exists', async () => {
    const { leagueId } = await adminSetup();

    const outsider = await signUp(harness.app, 'outsider@example.com', 'Outsider');
    await harness.db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.email, 'outsider@example.com'));

    const missing = await outsider.get(`/leagues/${String(leagueId)}/admin/members`);
    expect(missing.status).toBe(404);
  });

  it('still refuses a regular member', async () => {
    const { guest, leagueId } = await adminSetup();

    const forbidden = await guest.get(`/leagues/${String(leagueId)}/admin/members`);
    expect(forbidden.status).toBe(403);
  });
});
