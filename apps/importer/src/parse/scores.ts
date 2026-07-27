import type { Slot } from '@gridiron/rules';
import { SLOTS } from '@gridiron/rules';
import {
  asNumber,
  isBlank,
  normaliseLabel,
  type Rows,
  WorkbookError,
  type Workbook,
} from './workbook';

export const SCORES_SHEET = 'Scores & Ranking';

/**
 * The layout, stated once.
 *
 * Confirmed identical in the 2020, 2023 and 2025 workbooks — same stride, same base
 * column, same labels — which is strong evidence the 2026 file will parse too. The
 * parser asserts every one of these below rather than trusting it, because reading a
 * drifted layout as if it were this one would silently attribute picks to wrong weeks.
 */
const HEADER_ROW = 1;
const FIRST_PLAYER_ROW = 2;
const NAME_COL = 0;
const SEASON_SCORE_COL = 1;
const BASE_COL = 2;
const STRIDE = 8;

/** Offsets within one week's 8-column block. */
const TEAM_OFFSET: Readonly<Record<Slot, number>> = { win: 0, place: 1, show: 2 };
const EARNED_OFFSET: Readonly<Record<Slot, number>> = { win: 3, place: 4, show: 5 };
const TRIFECTA_OFFSET = 6;
const TOTAL_OFFSET = 7;

/** Labels for offsets 0..6, whitespace-normalised. The sheet writes `"Show "` with a trailing space. */
const BLOCK_LABELS: readonly string[] = [
  'Win (5 pt)',
  'Place (3 pt)',
  'Show (1 pt)',
  'Win',
  'Place',
  'Show',
  'Trifecta',
];

/** A cell that should have named a team but held something else. */
export interface MalformedCell {
  readonly week: number;
  readonly slot: Slot;
  /** What was actually there, for the report. */
  readonly value: string;
}

export interface SheetPick {
  readonly week: number;
  readonly slot: Slot;
  /** Raw, exactly as written — `ARZ`, `NOR`, `"KC "`. Resolved against the alias table later. */
  readonly teamToken: string;
  /** What the sheet credited this slot. Read only to reconcile against; never imported. */
  readonly earned: number | null;
}

export interface SheetWeek {
  readonly week: number;
  /** Only the filled slots. An unfilled slot is an absent entry, never a null team. */
  readonly picks: readonly SheetPick[];
  readonly trifecta: number | null;
  readonly total: number | null;
}

export interface SheetPlayer {
  /** 1-based spreadsheet row, so a report line can be pointed at in Excel. */
  readonly row: number;
  readonly rawName: string;
  readonly seasonScore: number | null;
  readonly weeks: readonly SheetWeek[];
  readonly malformed: readonly MalformedCell[];
}

export interface ScoresSheet {
  /** Derived from header width — 17 in 2020, 18 from 2021. Never assumed. */
  readonly weekCount: number;
  readonly players: readonly SheetPlayer[];
}

/**
 * Parse `Scores & Ranking`, the source of truth.
 *
 * Structure verified against the sheet's own formulas: the 8th column of each block is
 * `SUM` of the four earned columns, and the season score sums every 8th column.
 */
export function parseScores(workbook: Workbook): ScoresSheet {
  const rows = workbook.rows(SCORES_SHEET);
  const weekCount = assertLayout(workbook.path, rows);

  const players: SheetPlayer[] = [];
  for (let index = FIRST_PLAYER_ROW; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;

    // Blank rows are skipped rather than treated as the end of the roster. `Selection
    // History` in the 2023 workbook has a gap part-way down its player list, and
    // stopping at the first blank there would silently drop two thirds of the players —
    // the kind of partial read that looks like a successful run.
    const name = row[NAME_COL];
    if (isBlank(name)) continue;

    players.push(parsePlayer(row, index, weekCount));
  }

  if (players.length === 0) {
    throw new WorkbookError(`${workbook.path}: "${SCORES_SHEET}" has no player rows`);
  }
  return { weekCount, players };
}

function parsePlayer(
  row: readonly (string | number | boolean | Date | null)[],
  index: number,
  weekCount: number,
): SheetPlayer {
  const weeks: SheetWeek[] = [];
  const malformed: MalformedCell[] = [];

  for (let week = 1; week <= weekCount; week += 1) {
    const base = BASE_COL + (week - 1) * STRIDE;
    const picks: SheetPick[] = [];

    for (const slot of SLOTS) {
      const cell = row[base + TEAM_OFFSET[slot]];
      if (isBlank(cell)) continue;

      // A team cell holding a number is not a team the alias table failed to know — it
      // is a damaged cell. Recorded as a structural rejection for this slot so the
      // player's other two picks still import, rather than aborting the run.
      if (typeof cell !== 'string') {
        malformed.push({ week, slot, value: String(cell) });
        continue;
      }

      picks.push({
        week,
        slot,
        teamToken: cell,
        earned: asNumber(row[base + EARNED_OFFSET[slot]]),
      });
    }

    weeks.push({
      week,
      picks,
      trifecta: asNumber(row[base + TRIFECTA_OFFSET]),
      total: asNumber(row[base + TOTAL_OFFSET]),
    });
  }

  return {
    row: index + 1,
    rawName: String(row[NAME_COL]),
    seasonScore: asNumber(row[SEASON_SCORE_COL]),
    weeks,
    malformed,
  };
}

/**
 * Check the sheet is the shape this parser was written for, and return the week count.
 *
 * Every assertion here is one that, if skipped, would produce a *plausible but wrong*
 * import rather than an obvious failure — picks shifted a week, or scores read as
 * teams. A drifted 2026 workbook should stop the run and get looked at.
 */
function assertLayout(path: string, rows: Rows): number {
  const header = rows[HEADER_ROW];
  if (header === undefined) {
    throw new WorkbookError(`${path}: "${SCORES_SHEET}" has no header row`);
  }
  if (normaliseLabel(header[NAME_COL]) !== 'Player') {
    throw new WorkbookError(
      `${path}: expected "Player" at ${SCORES_SHEET}!A${String(HEADER_ROW + 1)}, found "${normaliseLabel(header[NAME_COL])}"`,
    );
  }
  if (normaliseLabel(header[SEASON_SCORE_COL]) !== 'Score') {
    throw new WorkbookError(
      `${path}: expected "Score" at ${SCORES_SHEET}!B${String(HEADER_ROW + 1)}, found "${normaliseLabel(header[SEASON_SCORE_COL])}"`,
    );
  }

  const weekCount = Math.floor((header.length - BASE_COL) / STRIDE);
  if (weekCount < 1) {
    throw new WorkbookError(
      `${path}: "${SCORES_SHEET}" is ${String(header.length)} columns wide — too narrow to hold a week`,
    );
  }

  for (let week = 1; week <= weekCount; week += 1) {
    const base = BASE_COL + (week - 1) * STRIDE;
    BLOCK_LABELS.forEach((expected, offset) => {
      const found = normaliseLabel(header[base + offset]);
      if (found !== expected) {
        throw new WorkbookError(
          `${path}: week ${String(week)} column ${String(base + offset + 1)} should be labelled "${expected}", found "${found}" — the layout has changed`,
        );
      }
    });

    // The block's own week label is the strongest check available: it proves the stride
    // has not drifted and that block N really is week N.
    const label = normaliseLabel(header[base + TOTAL_OFFSET]);
    const declared = /^Week ?#(\d+)$/u.exec(label)?.[1];
    if (declared === undefined || Number(declared) !== week) {
      throw new WorkbookError(
        `${path}: block ${String(week)} is labelled "${label}" where "Week #${String(week)}" was expected — the layout has changed`,
      );
    }
  }

  return weekCount;
}
