import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workbook, WorkbooksResponse } from '@gridiron/contracts';
import { workbookReportSchema } from '@gridiron/contracts';
import type { Membership } from '../data/leagues';
import { resolveSeason } from '../data/seasons';
import {
  insertWorkbook,
  listWorkbooks,
  requireWorkbook,
  updateWorkbookReport,
  type WorkbookRow,
} from '../data/workbooks';
import { ImporterError, type Deps } from '../deps';
import { badRequest, conflict, forbidden } from '../http/errors';

/**
 * 10 MB — the workbooks are a few hundred KB; anything larger is not a workbook.
 *
 * Exported because the request-body limit in `app.ts` must let a workbook through
 * while keeping every other route capped. The two must stay in lockstep, so the
 * number lives here, in the layer that owns the workbook rules.
 */
export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const EXTENSIONS = new Set(['.xlsx', '.xls']);

function assertOwner(actor: Membership): void {
  if (actor.role !== 'owner') throw forbidden('only the owner can do that');
}

function extensionOf(originalName: string): string | undefined {
  const lower = originalName.toLowerCase();
  for (const extension of EXTENSIONS) {
    if (lower.endsWith(extension)) return extension;
  }
  return undefined;
}

function filePath(deps: Deps, row: Pick<WorkbookRow, 'leagueId' | 'storedName'>): string {
  return join(deps.config.workbooksDir, String(row.leagueId), row.storedName);
}

function toWire(row: WorkbookRow): Workbook {
  const report = workbookReportSchema.safeParse(row.report);
  return {
    id: row.id,
    originalName: row.originalName,
    season: row.seasonYear,
    report: report.success ? report.data : null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    uploadedAt: row.createdAt.toISOString(),
  };
}

/**
 * Run the importer for a league, parse its report, and translate a fatal failure.
 *
 * The lock is the other half of this: one import at a time per league. The importer
 * reconciles the sheet against picks already in the database, so two runs racing — a
 * dry run against an apply, most likely — would each read a state the other is
 * changing. In-process, because the API runs as one container; a second replica would
 * move this to the database.
 */
const importingLeagues = new Set<number>();

async function withLeagueImport<T>(leagueId: number, run: () => Promise<T>): Promise<T> {
  if (importingLeagues.has(leagueId)) {
    throw conflict(
      'another import is already running for this league — try again once it finishes',
    );
  }
  importingLeagues.add(leagueId);
  try {
    return await run();
  } finally {
    importingLeagues.delete(leagueId);
  }
}

/**
 * Run the importer once and parse its report into the wire shape.
 *
 * A fatal importer failure (`ImporterError`) is the uploader's file talking — a drifted
 * layout, an unknown name — so it becomes a 400 carrying the sentence the importer
 * wrote. Anything else — a database fault, a report that does not match the contract —
 * is a genuine 500 and propagates untouched rather than being dressed up as the
 * user's mistake.
 */
async function importReport(
  deps: Deps,
  job: {
    readonly file: string;
    readonly leagueId: number;
    readonly year: number;
    readonly apply: boolean;
  },
) {
  try {
    return workbookReportSchema.parse(await deps.runImporter(job));
  } catch (error) {
    if (error instanceof ImporterError) throw badRequest(error.message);
    throw error;
  }
}

/**
 * Store an uploaded workbook and run a dry-run validation against it.
 *
 * The write is two-phase: the bytes land on disk and the row is recorded, then the
 * importer runs as a dry run and its report is stored. A report full of rejections or
 * conflicts is still a success — those are the findings the confirmation screen shows.
 * A fatal failure (a drifted layout, an unknown name) throws with the importer's own
 * sentence, and the row stays with a null report so the upload itself is not lost.
 */
export async function uploadWorkbook(
  deps: Deps,
  actor: Membership,
  input: { readonly originalName: string; readonly bytes: Uint8Array; readonly seasonYear: number },
): Promise<Workbook> {
  assertOwner(actor);

  const extension = extensionOf(input.originalName);
  if (extension === undefined) throw badRequest('only .xlsx or .xls workbooks');
  if (input.bytes.byteLength === 0) throw badRequest('the workbook is empty');
  if (input.bytes.byteLength > MAX_WORKBOOK_BYTES) throw badRequest('the workbook is too large');

  // The lock wraps the whole write, not just the importer run: a league mid-import
  // refuses a second upload before anything lands on disk, so a 409 never leaves a
  // half-recorded workbook behind.
  return withLeagueImport(actor.leagueId, async () => {
    const season = await resolveSeason(deps, input.seasonYear);
    const storedName = `${randomUUID()}${extension}`;
    const directory = join(deps.config.workbooksDir, String(actor.leagueId));
    await mkdir(directory, { recursive: true });
    const file = join(directory, storedName);
    await writeFile(file, input.bytes);

    const row = await insertWorkbook(deps, {
      leagueId: actor.leagueId,
      memberId: actor.memberId,
      seasonId: season.id,
      originalName: input.originalName,
      storedName,
    });

    const report = await importReport(deps, {
      file,
      leagueId: actor.leagueId,
      year: season.year,
      apply: false,
    });
    const updated = await updateWorkbookReport(deps, actor.leagueId, row.id, {
      report,
      appliedAt: null,
    });
    return toWire(updated);
  });
}

/** Re-run the importer with `--apply` — the confirmation step. */
export async function applyWorkbook(
  deps: Deps,
  actor: Membership,
  workbookId: number,
): Promise<Workbook> {
  assertOwner(actor);
  const row = await requireWorkbook(deps, actor.leagueId, workbookId);

  return withLeagueImport(actor.leagueId, async () => {
    const report = await importReport(deps, {
      file: filePath(deps, row),
      leagueId: actor.leagueId,
      year: row.seasonYear,
      apply: true,
    });
    const updated = await updateWorkbookReport(deps, actor.leagueId, workbookId, {
      report,
      appliedAt: deps.now(),
    });
    return toWire(updated);
  });
}

export async function listWorkbookUploads(
  deps: Deps,
  actor: Membership,
): Promise<WorkbooksResponse> {
  assertOwner(actor);
  const rows = await listWorkbooks(deps, actor.leagueId);
  return { workbooks: rows.map((row) => toWire(row)) };
}

export async function downloadWorkbook(
  deps: Deps,
  actor: Membership,
  workbookId: number,
): Promise<{ readonly name: string; readonly bytes: Uint8Array }> {
  assertOwner(actor);
  const row = await requireWorkbook(deps, actor.leagueId, workbookId);
  const bytes = await readFile(filePath(deps, row));
  return { name: row.originalName, bytes: new Uint8Array(bytes) };
}
