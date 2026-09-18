import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient, createHarness, signUp, type Harness } from './helpers';

let harness: Harness;
const jobs: { year: number; apply: boolean }[] = [];

function makeReport(apply: boolean): Record<string, unknown> {
  return {
    file: '/tmp/uploaded.xlsx',
    leagueName: 'Grid Iron',
    year: 2026,
    weekCount: 18,
    playerCount: 72,
    picksInSheet: 100,
    importable: 90,
    written: { inserted: 0, updated: 0, unchanged: 0 },
    membersCreated: [],
    rejections: [
      {
        playerName: 'Ben Hoy',
        week: 2,
        slot: 'win',
        teamToken: 'PHI',
        reasons: ['already used at Win in week 1'],
      },
    ],
    conflicts: [],
    crossCheck: [],
    scoring: [],
    removals: [],
    applied: apply,
  };
}

beforeAll(async () => {
  harness = await createHarness({
    env: { WORKBOOKS_DIR: mkdtempSync(join(tmpdir(), 'gridiron-workbooks-')) },
    runImporter: (job) => {
      jobs.push({ year: job.year, apply: job.apply });
      return Promise.resolve(makeReport(job.apply));
    },
  });
});

afterAll(async () => {
  await harness.close();
});

async function setup(): Promise<{ owner: ApiClient; leagueId: number }> {
  const owner = await signUp(harness.app, 'owner@example.com', 'Commissioner');
  const created = await owner.post<{ id: number }>('/leagues', { name: 'Grid Iron' });
  return { owner, leagueId: created.body.id };
}

function workbookForm(season = '2026'): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'workbook.xlsx'));
  form.append('season', season);
  return form;
}

beforeEach(async () => {
  jobs.length = 0;
  await harness.reset();
});

describe('workbook upload and apply', () => {
  it('stores and validates a workbook without importing', async () => {
    const { owner, leagueId } = await setup();

    const response = await owner.postForm<{
      id: number;
      originalName: string;
      report: { applied: boolean; rejections: unknown[] };
      appliedAt: string | null;
    }>(`/leagues/${String(leagueId)}/admin/workbooks`, workbookForm());

    expect(response.status).toBe(200);
    expect(response.body.originalName).toBe('workbook.xlsx');
    expect(response.body.report?.applied).toBe(false);
    expect(response.body.report?.rejections).toHaveLength(1);
    expect(response.body.appliedAt).toBeNull();
    expect(jobs).toEqual([{ year: 2026, apply: false }]);
  });

  it('applies a validated workbook on confirmation', async () => {
    const { owner, leagueId } = await setup();
    const uploaded = await owner.postForm<{ id: number }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );

    const applied = await owner.post<{ appliedAt: string | null; report: { applied: boolean } }>(
      `/leagues/${String(leagueId)}/admin/workbooks/${String(uploaded.body.id)}/apply`,
    );

    expect(applied.status).toBe(200);
    expect(applied.body.appliedAt).not.toBeNull();
    expect(applied.body.report.applied).toBe(true);
    expect(jobs).toEqual([
      { year: 2026, apply: false },
      { year: 2026, apply: true },
    ]);
  });

  it('downloads the stored bytes back unchanged', async () => {
    const { owner, leagueId } = await setup();
    const uploaded = await owner.postForm<{ id: number }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );

    const downloaded = await owner.getRaw(
      `/leagues/${String(leagueId)}/admin/workbooks/${String(uploaded.body.id)}/download`,
    );

    expect(downloaded.status).toBe(200);
    expect([...downloaded.body]).toEqual([1, 2, 3, 4]);
    expect(downloaded.contentType).toBe('application/octet-stream');
  });

  it('rejects a non-workbook file and a missing season', async () => {
    const { owner, leagueId } = await setup();

    const wrongType = new FormData();
    wrongType.append('file', new File([new Uint8Array([1])], 'notes.txt'));
    wrongType.append('season', '2026');
    expect(
      (await owner.postForm(`/leagues/${String(leagueId)}/admin/workbooks`, wrongType)).status,
    ).toBe(400);

    const noSeason = new FormData();
    noSeason.append('file', new File([new Uint8Array([1])], 'workbook.xlsx'));
    expect(
      (await owner.postForm(`/leagues/${String(leagueId)}/admin/workbooks`, noSeason)).status,
    ).toBe(400);
  });

  it('turns a regular member away', async () => {
    const { owner, leagueId } = await setup();
    const guest = await signUp(harness.app, 'guest@example.com', 'Guest');
    await guest.post('/leagues/join', {
      inviteCode: (await owner.get<{ inviteCode: string }>(`/leagues/${String(leagueId)}`)).body
        .inviteCode,
    });

    expect(
      (await guest.postForm(`/leagues/${String(leagueId)}/admin/workbooks`, workbookForm())).status,
    ).toBe(403);
    expect((await guest.get(`/leagues/${String(leagueId)}/admin/workbooks`)).status).toBe(403);
  });
});
