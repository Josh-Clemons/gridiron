import { asNumber, isBlank, normaliseLabel, type Workbook } from './workbook';

export const WINNERS_SHEET = 'Grid Iron Winners';

const YEAR_COL = 0;
const NAME_COL = 1;
const POINTS_COL = 2;

export type Pool = 'regular' | 'playoff';

export interface Champion {
  readonly year: number;
  readonly pool: Pool;
  readonly rawName: string;
  readonly totalPoints: number | null;
  /** 1-based spreadsheet row, so a report line can be pointed at in Excel. */
  readonly row: number;
}

/** A row that names no champion — a `?`, a blank, or the 2018 playoff's `no game`. */
export interface VacantYear {
  readonly year: number;
  readonly pool: Pool;
  readonly reason: string;
  readonly row: number;
}

export interface Winners {
  readonly champions: readonly Champion[];
  readonly vacant: readonly VacantYear[];
}

/**
 * Values in the name column that mean "nobody", not a person.
 *
 * These are skipped rather than stored. `champions.display_name` is NOT NULL, so any
 * stored form of them would be a fabricated champion, and 2018's playoff genuinely had
 * no game — the absence of a row is the honest record. They are reported so the
 * operator can see the year was considered and deliberately left empty.
 */
const NOT_A_CHAMPION: ReadonlyMap<string, string> = new Map([
  ['?', 'winner not yet recorded'],
  ['no game', 'no game was played'],
  ['tbd', 'winner not yet recorded'],
]);

/**
 * Parse `Grid Iron Winners` — regular-season champions from 2007, playoff champions
 * from 2012.
 *
 * Absent entirely from the 2020 workbook, which is why the caller treats this sheet as
 * optional. **Later workbooks correct earlier ones**: the 2023 file still lists 2023's
 * winner as `?` where the 2025 file has Ralph Ramirez, so this should be run against
 * the newest workbook available.
 */
export function parseWinners(workbook: Workbook): Winners {
  const rows = workbook.rows(WINNERS_SHEET);
  const champions: Champion[] = [];
  const vacant: VacantYear[] = [];

  // The sheet holds two stacked tables. Which pool we are in is decided by the header
  // rows themselves rather than by row number, because the regular-season table grows
  // by one row a year and would push a hardcoded boundary out of date every season.
  let pool: Pool = 'regular';
  let lastYear: number | null = null;

  for (const [index, row] of rows.entries()) {
    const yearCell = row[YEAR_COL];
    const nameCell = row[NAME_COL];
    const label = normaliseLabel(nameCell);

    if (normaliseLabel(yearCell) === 'Year') {
      pool = /playoff/iu.test(label) ? 'playoff' : 'regular';
      lastYear = null;
      continue;
    }

    const year = asNumber(yearCell);
    if (year !== null && year >= 2000 && year <= 2100) lastYear = year;

    if (isBlank(nameCell)) {
      // A year with no name at all: the current season, still being played.
      if (year !== null && year >= 2000 && year <= 2100) {
        vacant.push({ year, pool, reason: 'winner not yet recorded', row: index + 1 });
      }
      continue;
    }

    /**
     * A name with no year belongs to the year above it — these are co-champions.
     *
     * 2022 is the real case: Kevin Fournier and Meaghan Olender both finished on 146.
     * An earlier pass over these files read the pair as a junk row with a nonsense year
     * column, which was an artefact of hand-parsing self-closing cells; read properly
     * it is a tie, and both names belong in the champions list.
     */
    const effectiveYear = year !== null && year >= 2000 && year <= 2100 ? year : lastYear;
    if (effectiveYear === null) continue;

    const vacantReason = NOT_A_CHAMPION.get(label.toLowerCase());
    if (vacantReason !== undefined) {
      vacant.push({ year: effectiveYear, pool, reason: vacantReason, row: index + 1 });
      continue;
    }

    champions.push({
      year: effectiveYear,
      pool,
      rawName: String(nameCell),
      totalPoints: asNumber(row[POINTS_COL]),
      row: index + 1,
    });
  }

  return { champions, vacant };
}
