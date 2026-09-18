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
import type { Deps } from '../deps';
import { badRequest, forbidden } from '../http/errors';

/** 10 MB — the workbooks are a few hundred KB; anything larger is not a workbook. */
const MAX_BYTES = 10 * 1024 * 1024;
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
 * Store an uploaded workbook and run a dry-run validation against it.
 *
 * The write is two-phase: the bytes land on disk and the row is recorded, then the
 * importer runs as a dry run and its report is stored. A report full of rejections or
 * conflicts is still a success — those are the findings the confirmation screen shows.
 * A fatal failure (a drifted layout, an unknown name) throws, and the row stays with a
 * null report so the upload itself is not lost.
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
  if (input.bytes.byteLength > MAX_BYTES) throw badRequest('the workbook is too large');

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

  try {
    const report = await deps.runImporter({
      file,
      leagueId: actor.leagueId,
      year: season.year,
      apply: false,
    });
    const parsed = workbookReportSchema.parse(report);
    const updated = await updateWorkbookReport(deps, actor.leagueId, row.id, {
      report: parsed,
      appliedAt: null,
    });
    return toWire(updated);
  } catch (error) {
    if (error instanceof Error) throw badRequest(error.message);
    throw error;
  }
}

/** Re-run the importer with `--apply` — the confirmation step. */
export async function applyWorkbook(
  deps: Deps,
  actor: Membership,
  workbookId: number,
): Promise<Workbook> {
  assertOwner(actor);
  const row = await requireWorkbook(deps, actor.leagueId, workbookId);

  const report = await deps.runImporter({
    file: filePath(deps, row),
    leagueId: actor.leagueId,
    year: row.seasonYear,
    apply: true,
  });
  const parsed = workbookReportSchema.parse(report);
  const updated = await updateWorkbookReport(deps, actor.leagueId, workbookId, {
    report: parsed,
    appliedAt: deps.now(),
  });
  return toWire(updated);
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
