import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ImporterError } from '../src/deps';
import { ApiClient, createHarness, signUp, type Harness } from './helpers';

let harness: Harness;
const jobs: { year: number; apply: boolean }[] = [];

/** Swap per test: the default is the cooperative fake the happy-path tests use. */
let importer: (job: {
  readonly leagueId: number;
  readonly year: number;
  readonly apply: boolean;
}) => Promise<unknown> = () => Promise.resolve(makeReport(false));

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
    runImporter: (job) => importer(job),
  });
});

afterAll(async () => {
  await harness.close();
});

async function setup(email = 'owner@example.com'): Promise<{ owner: ApiClient; leagueId: number }> {
  const owner = await signUp(harness.app, email, 'Commissioner');
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
  importer = (job) => {
    jobs.push({ year: job.year, apply: job.apply });
    return Promise.resolve(makeReport(job.apply));
  };
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

  it('accepts a workbook larger than the JSON body limit', async () => {
    const { owner, leagueId } = await setup();

    // 200 KB — past the 64 KB cap every non-upload route keeps. A real workbook is
    // this size; the upload route must not inherit the JSON limit.
    const form = new FormData();
    form.append('file', new File([new Uint8Array(200 * 1024)], 'workbook.xlsx'));
    form.append('season', '2026');

    const response = await owner.postForm<{ originalName: string }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      form,
    );

    expect(response.status).toBe(200);
    expect(response.body.originalName).toBe('workbook.xlsx');
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

describe('the import seam', () => {
  it("answers 400 with the importer's own sentence when the run fails fatally", async () => {
    const { owner, leagueId } = await setup();
    importer = () =>
      Promise.reject(new ImporterError('no "Scores & Ranking" sheet in this workbook'));

    const response = await owner.postForm<{ error: { code: string; message: string } }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('no "Scores & Ranking" sheet in this workbook');
  });

  it("answers 500 without detail when the failure is not the file's fault", async () => {
    const { owner, leagueId } = await setup();
    // A database fault, not an ImporterError: the uploader must not see it dressed up
    // as their mistake, and the message must not leak internals.
    importer = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5433'));

    const response = await owner.postForm<{ error: { code: string; message: string } }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('internal error');
  });

  it('refuses a second import for the same league while one is running', async () => {
    const { owner, leagueId } = await setup();
    // A completed upload first, so there is a workbook to apply.
    const uploaded = await owner.postForm<{ id: number }>(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    importer = (job) => {
      jobs.push({ year: job.year, apply: job.apply });
      return new Promise((resolve) => {
        void gate.then(() => {
          resolve(makeReport(false));
        });
      });
    };

    // An apply is in flight and gated; the upload arriving beside it must be refused
    // with 409 before it writes anything to disk or the database.
    const inFlight = owner.post(
      `/leagues/${String(leagueId)}/admin/workbooks/${String(uploaded.body.id)}/apply`,
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const refused = await owner.postForm(
      `/leagues/${String(leagueId)}/admin/workbooks`,
      workbookForm(),
    );
    expect(refused.status).toBe(409);

    release?.();
    expect((await inFlight).status).toBe(200);
    // The refused upload never reached the importer — the upload, then the gated apply.
    expect(jobs).toEqual([
      { year: 2026, apply: false },
      { year: 2026, apply: true },
    ]);
  });

  it('lets two different leagues import at once', async () => {
    const first = await setup('first@example.com');
    const second = await setup('second@example.com');

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    importer = (job) => {
      jobs.push({ year: job.year, apply: job.apply });
      // Only the first league is gated; a second league must be free to run beside it.
      if (job.leagueId !== first.leagueId) return Promise.resolve(makeReport(false));
      return new Promise((resolve) => {
        void gate.then(() => {
          resolve(makeReport(false));
        });
      });
    };

    const inFlight = first.owner.postForm(
      `/leagues/${String(first.leagueId)}/admin/workbooks`,
      workbookForm(),
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    // A different league is a different lock — this one must go through.
    const other = await second.owner.postForm(
      `/leagues/${String(second.leagueId)}/admin/workbooks`,
      workbookForm(),
    );
    expect(other.status).toBe(200);

    release?.();
    expect((await inFlight).status).toBe(200);
  });
});
