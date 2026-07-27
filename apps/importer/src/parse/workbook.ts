import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

/**
 * A cell as SheetJS hands it back with `raw: true`.
 *
 * Deliberately not narrowed to `string`: the whole point of reading raw is that the
 * parser gets to decide what a number in a team-name column means, rather than having
 * a formatter quietly stringify it first.
 */
export type Cell = string | number | boolean | Date | null;
export type Row = readonly Cell[];
export type Rows = readonly Row[];

/**
 * A problem that stops the run.
 *
 * Thrown only for damage the operator has to look at — a missing sheet, a layout that
 * no longer matches, an unresolvable name. Anything wrong with a *single pick* is a
 * per-pick rejection instead and never reaches this class.
 */
export class WorkbookError extends Error {
  override readonly name = 'WorkbookError';
}

export interface Workbook {
  readonly path: string;
  readonly sheetNames: readonly string[];
  has(name: string): boolean;
  /** Every row of a sheet, rectangular and null-padded. Throws if the sheet is absent. */
  rows(name: string): Rows;
}

/**
 * Open a workbook, `.xlsx` or legacy BIFF8 `.xls`.
 *
 * SheetJS reads both formats, which is why it is worth the non-registry install: the
 * 2020 and 2023 workbooks are OLE2 files written by Excel 2007 and there is no
 * conversion step in front of them.
 */
export function readWorkbook(path: string): Workbook {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkbookError(`could not read ${path}: ${detail}`);
  }

  const sheetNames = [...book.SheetNames];

  /**
   * Sheets are found by name, never by index.
   *
   * The three known workbooks disagree on ordering and on which sheets exist at all —
   * 2020 has no `Grid Iron Winners`, 2025 has a stray `Sheet1` — so an index would read
   * the wrong sheet on some years and the right one on others.
   */
  function find(name: string): string | undefined {
    if (sheetNames.includes(name)) return name;
    const wanted = name.trim().toLowerCase();
    return sheetNames.find((candidate) => candidate.trim().toLowerCase() === wanted);
  }

  return {
    path,
    sheetNames,
    has: (name): boolean => find(name) !== undefined,
    rows: (name): Rows => {
      const resolved = find(name);
      if (resolved === undefined) {
        throw new WorkbookError(
          `${path} has no sheet named "${name}" — found ${sheetNames.map((s) => `"${s}"`).join(', ')}`,
        );
      }
      const sheet = book.Sheets[resolved];
      if (sheet === undefined) throw new WorkbookError(`${path}: sheet "${resolved}" is empty`);
      return toRows(sheet);
    },
  };
}

/**
 * A sheet as a rectangular array.
 *
 * `sheet_to_json` returns ragged rows — a row stops at its last populated cell — so
 * `row[40]` is `undefined` on a short row and `null` on a long one. Padding to the
 * declared width erases that distinction, which matters because every column index in
 * this parser is computed rather than iterated.
 */
function toRows(sheet: XLSX.WorkSheet): Rows {
  const ref = sheet['!ref'];
  if (ref === undefined) return [];
  const width = XLSX.utils.decode_range(ref).e.c + 1;

  const raw = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  return raw.map((row) => {
    const padded: Cell[] = row.map((cell) => (cell === undefined ? null : cell));
    while (padded.length < width) padded.push(null);
    return padded;
  });
}

/**
 * The readers below all accept `undefined` as well as `Cell`.
 *
 * Every column index in this parser is computed rather than iterated, so under
 * `noUncheckedIndexedAccess` each read is `Cell | undefined`. Absorbing that here beats
 * `?? null` at forty call sites, and an off-the-end column means the same thing as an
 * empty one anyway.
 */

/** Collapse the whitespace and markers that vary between copies of a label. */
export function normaliseLabel(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).replaceAll(/\s+/gu, ' ').trim();
}

/** A cell that holds real content. Blank strings count as empty, not as data. */
export function isBlank(cell: Cell | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

/** Read a cell that must be a number, or `null` if it is blank or non-numeric. */
export function asNumber(cell: Cell | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'string' && cell.trim() !== '') {
    const parsed = Number(cell.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
