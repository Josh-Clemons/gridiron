import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

export interface WeekSpec {
  readonly win?: string | number;
  readonly place?: string | number;
  readonly show?: string | number;
  /** What the sheet credits each slot. Defaults to blank, which reads as "unscored". */
  readonly earned?: readonly [number | null, number | null, number | null];
  readonly trifecta?: number;
  readonly total?: number;
}

export interface PlayerSpec {
  readonly name: string;
  /** One entry per week, from week 1. Missing or empty entries are unfilled weeks. */
  readonly weeks: readonly (WeekSpec | null)[];
  readonly seasonScore?: number;
}

export interface WorkbookSpec {
  readonly weekCount: number;
  readonly players: readonly PlayerSpec[];
}

/**
 * Build a workbook in the commissioner's exact layout.
 *
 * The rejection and conflict cases need files containing one specific mistake, and
 * hand-doctoring a copy of a real workbook would leave a binary in the repo that nobody
 * can read a diff of. Generating them states the mistake in the test instead — "PHI in
 * two slots in one week" is right there in the source.
 *
 * The header this writes is the one `parseScores` asserts, trailing space on `"Show "`
 * included, so a drift in either would fail loudly rather than quietly agreeing.
 */
export function buildWorkbook(spec: WorkbookSpec): string {
  const header: (string | number | null)[] = ['Player', 'Score'];
  const top: (string | number | null)[] = [null, null];

  for (let week = 1; week <= spec.weekCount; week += 1) {
    top.push(`Week #${String(week)}`, null, null, null, null, null, null, null);
    header.push(
      'Win (5 pt)',
      'Place (3 pt)',
      'Show (1 pt)',
      'Win',
      'Place',
      'Show ',
      'Trifecta',
      `Week #${String(week)}`,
    );
  }

  const rows: (string | number | null)[][] = [top, header];

  for (const player of spec.players) {
    const row: (string | number | null)[] = [player.name, player.seasonScore ?? null];
    for (let week = 1; week <= spec.weekCount; week += 1) {
      const entry = player.weeks[week - 1] ?? null;
      row.push(
        entry?.win ?? null,
        entry?.place ?? null,
        entry?.show ?? null,
        entry?.earned?.[0] ?? null,
        entry?.earned?.[1] ?? null,
        entry?.earned?.[2] ?? null,
        entry?.trifecta ?? null,
        entry?.total ?? null,
      );
    }
    rows.push(row);
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Scores & Ranking');

  const path = join(mkdtempSync(join(tmpdir(), 'gridiron-importer-')), 'workbook.xlsx');
  const buffer: unknown = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  if (!Buffer.isBuffer(buffer)) throw new TypeError('SheetJS did not return a buffer');
  writeFileSync(path, buffer);
  return path;
}
