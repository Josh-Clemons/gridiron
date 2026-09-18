import * as XLSX from 'xlsx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, insertGames, signUp, type Harness } from './helpers';

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

async function setup(): Promise<{ owner: ApiClient; leagueId: number }> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Commissioner');
  const created = await owner.post<{ id: number }>('/leagues', { name: 'Grid Iron' });
  await insertGames(harness.db, 2026, 1, [
    { home: 'KC', away: 'DEN', kickoff: new Date('2026-09-10T23:20:00Z') },
    { home: 'BUF', away: 'NYJ', kickoff: new Date('2026-09-13T17:00:00Z') },
    { home: 'DAL', away: 'PHI', kickoff: new Date('2026-09-13T17:00:00Z') },
  ]);
  return { owner, leagueId: created.body.id };
}

describe('workbook export', () => {
  it('recreates the Scores & Ranking and Selection History sheets from the database', async () => {
    const { owner, leagueId } = await setup();
    await owner.put(`/leagues/${String(leagueId)}/picks/1/win`, { teamId: 'KC' });

    const response = await owner.getRaw(`/leagues/${String(leagueId)}/admin/export?season=2026`);

    expect(response.status).toBe(200);
    expect(response.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const book = XLSX.read(Buffer.from(response.body), { type: 'buffer' });
    expect(book.SheetNames).toEqual(['Scores & Ranking', 'Selection History']);

    const scoresSheet = book.Sheets['Scores & Ranking'];
    if (scoresSheet === undefined) throw new Error('missing Scores & Ranking sheet');
    const scores = XLSX.utils.sheet_to_json<unknown[]>(scoresSheet, { header: 1 });
    const header = scores[0];
    expect(header?.[0]).toBe('Player');
    expect(header?.[1]).toBe('Score');

    const ownerRow = scores.find((row) => row[0] === 'Commissioner');
    expect(ownerRow).toBeDefined();
    // Win is the first cell of the week-1 block, right after name and season score.
    expect(ownerRow?.[2]).toBe('KC');
  });

  it('turns a regular member away', async () => {
    const { owner, leagueId } = await setup();
    const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
    await guest.post('/leagues/join', {
      inviteCode: (await owner.get<{ inviteCode: string }>(`/leagues/${String(leagueId)}`)).body
        .inviteCode,
    });

    expect(
      (await guest.getRaw(`/leagues/${String(leagueId)}/admin/export?season=2026`)).status,
    ).toBe(403);
  });
});
