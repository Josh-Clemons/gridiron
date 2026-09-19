import type { Ranked, ScoredMember } from './standings';

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

/**
 * Season standings as CSV: rank, player, season points.
 *
 * Built from the same ranked rows the standings page renders, so a downloaded file
 * can never disagree with what the table on screen showed.
 */
export function standingsCsv(rows: readonly Ranked<ScoredMember>[]): string {
  const lines = [csvRow(['Rank', 'Player', 'Season Points'])];
  for (const { row, rank } of rows) {
    lines.push(csvRow([rank, row.displayName, row.seasonPoints]));
  }
  return `${lines.join('\r\n')}\r\n`;
}
