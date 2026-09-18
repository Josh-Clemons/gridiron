import * as XLSX from 'xlsx';
import { scoreSeason, type Game } from '@gridiron/rules';
import type { Membership } from '../data/leagues';
import { listMembers } from '../data/leagues';
import { loadGames, loadLeaguePicks, type PickRow } from '../data/picks';
import { resolveSeason } from '../data/seasons';
import type { TeamRow } from '../data/teams';
import type { Deps } from '../deps';
import { forbidden } from '../http/errors';

const SCORES_SHEET = 'Scores & Ranking';
const HISTORY_SHEET = 'Selection History';

/**
 * The spreadsheet layout, mirrored from the importer's parse layer
 * (`apps/importer/src/parse/scores.ts` and `selection-history.ts`). The importer reads
 * these two sheets; this writes them back. The layout constants are repeated on purpose
 * — reading and writing are opposite directions, and the parse side asserts every
 * offset it relies on, so a drift would be caught there, not silently reproduced here.
 */
function assertOwner(actor: Membership): void {
  if (actor.role !== 'owner') throw forbidden('only the owner can do that');
}

/**
 * The commissioner's `Selection History` column order: code-alphabetical, except SF
 * precedes SEA — the one documented quirk, present in all three known workbooks.
 */
function historyOrder(teams: readonly TeamRow[]): TeamRow[] {
  const sorted = teams.toSorted((a, b) => a.code.localeCompare(b.code));
  const sf = sorted.findIndex((team) => team.code === 'SF');
  const sea = sorted.findIndex((team) => team.code === 'SEA');
  if (sf > sea) {
    const sfTeam = sorted.splice(sf, 1)[0];
    if (sfTeam !== undefined) sorted.splice(sea, 0, sfTeam);
  }
  return sorted;
}

/** Recreate the commissioner's workbook from the database, one season at a time. */
export async function exportLeagueWorkbook(
  deps: Deps,
  actor: Membership,
  year: number | undefined,
): Promise<{ readonly name: string; readonly bytes: Uint8Array }> {
  assertOwner(actor);
  const season = await resolveSeason(deps, year);
  const [members, picks, games, catalog] = await Promise.all([
    listMembers(deps, actor.leagueId),
    loadLeaguePicks(deps, actor.leagueId, season.id),
    loadGames(deps, season.id),
    deps.teams(),
  ]);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(buildScoresSheet(members, picks, games, season.weekCount)),
    SCORES_SHEET,
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(buildHistorySheet(members, picks, catalog.list())),
    HISTORY_SHEET,
  );

  const written: unknown = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  if (!(written instanceof Uint8Array)) {
    throw new Error('xlsx write returned an unexpected type');
  }
  return { name: `gridiron-${String(season.year)}.xlsx`, bytes: written };
}

function buildScoresSheet(
  members: readonly { id: number; displayName: string }[],
  picks: readonly PickRow[],
  games: readonly Game[],
  weekCount: number,
): (string | number)[][] {
  const header: (string | number)[] = ['Player', 'Score'];
  for (let week = 1; week <= weekCount; week += 1) {
    header.push(
      'Win (5 pt)',
      'Place (3 pt)',
      'Show (1 pt)',
      'Win',
      'Place',
      'Show',
      'Trifecta',
      `Week #${week}`,
    );
  }

  const rows: (string | number)[][] = [header];
  for (const member of members) {
    const season = scoreSeason(
      picks.filter((pick) => pick.memberId === member.id),
      games,
      weekCount,
    );

    const row: (string | number)[] = [member.displayName, season.total];
    for (const week of season.weeks) {
      // `scoreWeek` returns the three slots in Win/Place/Show order.
      const [win, place, show] = week.slots;
      row.push(
        win?.teamId ?? '',
        place?.teamId ?? '',
        show?.teamId ?? '',
        win?.points ?? 0,
        place?.points ?? 0,
        show?.points ?? 0,
        week.trifecta,
        week.total,
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildHistorySheet(
  members: readonly { id: number; displayName: string }[],
  picks: readonly PickRow[],
  teams: readonly TeamRow[],
): (string | number)[][] {
  const ordered = historyOrder(teams);

  // Row 1 carries the team code centred over each three-column group; row 2 labels
  // the three slots 5/3/1; every following row is a player.
  const teamRow: (string | number)[] = [''];
  const headerRow: (string | number)[] = ['Player'];
  for (const team of ordered) {
    teamRow.push('', team.code, '');
    headerRow.push(5, 3, 1);
  }
  const rows: (string | number)[][] = [teamRow, headerRow];

  for (const member of members) {
    const weekByKey = new Map<string, number>();
    for (const pick of picks.filter((candidate) => candidate.memberId === member.id)) {
      weekByKey.set(`${pick.slot}:${pick.teamId}`, pick.week);
    }

    const row: (string | number)[] = [member.displayName];
    for (const team of ordered) {
      row.push(
        weekByKey.get(`win:${team.code}`) ?? '',
        weekByKey.get(`place:${team.code}`) ?? '',
        weekByKey.get(`show:${team.code}`) ?? '',
      );
    }
    rows.push(row);
  }
  return rows;
}
