import { seasons, workbooks } from '@gridiron/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Deps } from '../deps';
import { notFound } from '../http/errors';

/** A stored workbook, with the season year it targets denormalised for the wire. */
export interface WorkbookRow {
  readonly id: number;
  readonly leagueId: number;
  readonly memberId: number;
  readonly seasonId: number;
  readonly seasonYear: number;
  readonly originalName: string;
  readonly storedName: string;
  readonly report: unknown;
  readonly appliedAt: Date | null;
  readonly createdAt: Date;
}

const selection = {
  id: workbooks.id,
  leagueId: workbooks.leagueId,
  memberId: workbooks.memberId,
  seasonId: workbooks.seasonId,
  seasonYear: seasons.year,
  originalName: workbooks.originalName,
  storedName: workbooks.storedName,
  report: workbooks.report,
  appliedAt: workbooks.appliedAt,
  createdAt: workbooks.createdAt,
};

export async function insertWorkbook(
  deps: Deps,
  input: {
    readonly leagueId: number;
    readonly memberId: number;
    readonly seasonId: number;
    readonly originalName: string;
    readonly storedName: string;
  },
): Promise<WorkbookRow> {
  const rows = await deps.db.insert(workbooks).values(input).returning({ id: workbooks.id });
  const row = rows[0];
  if (row === undefined) throw new Error('workbook insert returned nothing');
  return requireWorkbook(deps, input.leagueId, row.id);
}

export function listWorkbooks(deps: Deps, leagueId: number): Promise<WorkbookRow[]> {
  return deps.db
    .select(selection)
    .from(workbooks)
    .innerJoin(seasons, eq(seasons.id, workbooks.seasonId))
    .where(eq(workbooks.leagueId, leagueId))
    .orderBy(desc(workbooks.createdAt));
}

export async function requireWorkbook(
  deps: Deps,
  leagueId: number,
  workbookId: number,
): Promise<WorkbookRow> {
  const rows = await deps.db
    .select(selection)
    .from(workbooks)
    .innerJoin(seasons, eq(seasons.id, workbooks.seasonId))
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.leagueId, leagueId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw notFound('workbook not found');
  return row;
}

export async function updateWorkbookReport(
  deps: Deps,
  leagueId: number,
  workbookId: number,
  input: { readonly report: unknown; readonly appliedAt: Date | null },
): Promise<WorkbookRow> {
  const rows = await deps.db
    .update(workbooks)
    .set({ report: input.report, appliedAt: input.appliedAt })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.leagueId, leagueId)))
    .returning({ id: workbooks.id });
  const row = rows[0];
  if (row === undefined) throw notFound('workbook not found');
  return requireWorkbook(deps, leagueId, workbookId);
}
