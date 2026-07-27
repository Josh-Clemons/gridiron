import type { Slot } from '@gridiron/rules';
import { asNumber, isBlank, normaliseLabel, WorkbookError, type Workbook } from './workbook';

export const HISTORY_SHEET = 'Selection History';

const TEAM_ROW = 0;
const HEADER_ROW = 1;
const FIRST_PLAYER_ROW = 2;
const NAME_COL = 0;
/** Each team occupies three columns; the team's name sits over the middle one. */
const GROUP_WIDTH = 3;
const FIRST_GROUP_COL = 1;

/** The slot each column of a group stands for, labelled 5 / 3 / 1 in the sheet. */
const GROUP_SLOTS: readonly Slot[] = ['win', 'place', 'show'];
const GROUP_LABELS: readonly number[] = [5, 3, 1];

export interface HistoryEntry {
  readonly teamToken: string;
  readonly slot: Slot;
  /** The week this team was used in this slot, as the tab records it. */
  readonly week: number;
}

export interface HistoryPlayer {
  readonly row: number;
  readonly rawName: string;
  readonly entries: readonly HistoryEntry[];
  /** Cells holding something that is not a usable week number, e.g. 2020's `wk36`. */
  readonly unreadable: readonly { teamToken: string; slot: Slot; value: string }[];
}

export interface SelectionHistory {
  readonly players: readonly HistoryPlayer[];
}

/**
 * Parse `Selection History` — a player × team × slot grid holding the week each team
 * was used.
 *
 * Hand-maintained with no formulas, and it agrees with `Scores & Ranking` at about 99%
 * across the three known workbooks, which makes it a genuine second opinion rather
 * than a copy. It is never authoritative: `Scores & Ranking` wins every disagreement.
 * The value here is that its mistakes are *patterned* — a whole week logged one column
 * off — which is exactly the kind of transcription slip worth surfacing.
 */
export function parseSelectionHistory(workbook: Workbook, weekCount: number): SelectionHistory {
  const rows = workbook.rows(HISTORY_SHEET);
  const teamRow = rows[TEAM_ROW];
  const header = rows[HEADER_ROW];
  if (teamRow === undefined || header === undefined) {
    throw new WorkbookError(`${workbook.path}: "${HISTORY_SHEET}" has no header rows`);
  }
  if (normaliseLabel(header[NAME_COL]) !== 'Player') {
    throw new WorkbookError(
      `${workbook.path}: expected "Player" at ${HISTORY_SHEET}!A${String(HEADER_ROW + 1)}`,
    );
  }

  /**
   * Column groups, read from the header rather than assumed.
   *
   * The ordering is *nearly* alphabetical but not quite — SF precedes SEA in all three
   * workbooks — so a generated column order would silently swap those two teams'
   * histories.
   */
  const groups: { readonly teamToken: string; readonly firstCol: number }[] = [];
  for (let col = FIRST_GROUP_COL; col + GROUP_WIDTH - 1 < teamRow.length; col += GROUP_WIDTH) {
    const label = normaliseLabel(teamRow[col + 1]);
    if (label === '') continue;

    // Only trust a group whose 5/3/1 labels are intact; anything else is drift or a
    // stray cell out to the right of the real grid.
    const labelled = GROUP_LABELS.every(
      (points, offset) => asNumber(header[col + offset]) === points,
    );
    if (!labelled) {
      throw new WorkbookError(
        `${workbook.path}: "${HISTORY_SHEET}" group for "${label}" at column ${String(col + 1)} is not labelled 5/3/1 — the layout has changed`,
      );
    }
    groups.push({ teamToken: label, firstCol: col });
  }

  if (groups.length === 0) {
    throw new WorkbookError(`${workbook.path}: "${HISTORY_SHEET}" has no team columns`);
  }

  const players: HistoryPlayer[] = [];
  for (let index = FIRST_PLAYER_ROW; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    // Skipped, not treated as the end: the 2023 tab has a gap part-way down its player
    // list, and breaking there would quietly read 17 of its 50 players.
    const name = row[NAME_COL];
    if (isBlank(name)) continue;

    const entries: HistoryEntry[] = [];
    const unreadable: { teamToken: string; slot: Slot; value: string }[] = [];

    for (const group of groups) {
      GROUP_SLOTS.forEach((slot, offset) => {
        const cell = row[group.firstCol + offset];
        if (isBlank(cell)) return;

        // Cells are usually plain week numbers, but the tab is hand-typed and 2020
        // contains a `wk36`. Pull the digits out, then range-check against the season:
        // a week this season never had is a transcription slip, not a pick.
        const digits = /\d+/u.exec(String(cell))?.[0];
        const week = digits === undefined ? null : Number(digits);
        if (week === null || week < 1 || week > weekCount) {
          unreadable.push({ teamToken: group.teamToken, slot, value: String(cell) });
          return;
        }
        entries.push({ teamToken: group.teamToken, slot, week });
      });
    }

    players.push({ row: index + 1, rawName: String(name), entries, unreadable });
  }

  return { players };
}
