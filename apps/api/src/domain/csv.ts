import { SLOTS, SLOT_POINTS, type Game } from '@gridiron/rules';
import type { PickRow } from '../data/picks';
import { groupGamesByWeek, lockedPicksOf, type Ranked, type ScoredMember } from './standings';

/**
 * One CSV field, quoted only when it has to be (RFC 4180).
 *
 * A roster label can hold a comma or a quote — the commissioner's sheet has joint
 * entries like `Sean Gould/Joe Borrelli` — so a naive comma-join would corrupt the
 * file on exactly the names that most need to export cleanly.
 */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(fields: readonly (string | number)[]): string {
  return fields.map((field) => csvField(field)).join(',');
}

export interface StandingsCsvInput {
  readonly picks: readonly PickRow[];
  readonly games: readonly Game[];
  readonly weekCount: number;
  readonly now: Date;
}

/**
 * Season standings as CSV: rank, player, season points, then per week the three
 * slots' locked picks and the week's points.
 *
 * Each week is four columns — the three slots headed `5`/`3`/`1` (Win/Place/Show in
 * point order), then `W1`…`W18` for that week's score. The pick columns carry the
 * team code of a locked pick, blank otherwise.
 *
 * Built from the same ranked rows and the same `lockedPicksOf` filter the standings
 * page renders, so a downloaded file can never disagree with the table on screen, and
 * a pick still open never appears in the file.
 */
export function standingsCsv(
  rows: readonly Ranked<ScoredMember>[],
  input: StandingsCsvInput,
): string {
  const header: (string | number)[] = ['Rank', 'Player', 'Season Points'];
  for (let week = 1; week <= input.weekCount; week += 1) {
    for (const slot of SLOTS) {
      header.push(SLOT_POINTS[slot]);
    }
    header.push(`W${String(week)}`);
  }

  const gamesByWeek = groupGamesByWeek(input.games);
  const picksByMember = new Map<number, PickRow[]>();
  for (const pick of input.picks) {
    const list = picksByMember.get(pick.memberId) ?? [];
    list.push(pick);
    picksByMember.set(pick.memberId, list);
  }

  const lines = [csvRow(header)];
  for (const { row, rank } of rows) {
    const memberPicks = picksByMember.get(row.memberId) ?? [];
    const fields: (string | number)[] = [rank, row.displayName, row.seasonPoints];
    for (let week = 1; week <= input.weekCount; week += 1) {
      const locked = lockedPicksOf(week, memberPicks, gamesByWeek.get(week) ?? [], input.now);
      for (const slot of SLOTS) {
        fields.push(locked.find((pick) => pick.slot === slot)?.teamId ?? '');
      }
      fields.push(row.weekly[week - 1] ?? 0);
    }
    lines.push(csvRow(fields));
  }
  return `${lines.join('\r\n')}\r\n`;
}
