import type { SeasonHistory } from '@gridiron/contracts';
import type { Game } from '@gridiron/rules';
import type { Membership } from '../data/leagues';
import { listMembers } from '../data/leagues';
import { loadGames, loadLeaguePicks } from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { groupGamesByWeek, rankMembers, scoreMembers } from './standings';

/**
 * A whole season as a member × week grid.
 *
 * This is the one view that is deliberately season-wide rather than one week at a
 * time, and it stays small by shipping only the totals: 72 members × 18 weeks is about
 * 1,300 integers. No member's picks are in it — the pick page remains the only place
 * that sends picks anywhere, and only ever the caller's own.
 */
export async function buildSeasonHistory(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
): Promise<SeasonHistory> {
  const [games, picks, members] = await Promise.all([
    loadGames(deps, season.id),
    loadLeaguePicks(deps, membership.leagueId, season.id),
    listMembers(deps, membership.leagueId),
  ]);

  const scored = scoreMembers({
    members,
    picks,
    games,
    weekCount: season.weekCount,
    selfMemberId: membership.memberId,
  });

  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    weeks: settledByWeek(games, season.weekCount),
    rows: rankMembers(scored).map(({ row, rank }) => ({
      memberId: row.memberId,
      displayName: row.displayName,
      claimed: row.claimed,
      isSelf: row.isSelf,
      rank,
      seasonPoints: row.seasonPoints,
      points: [...row.weekly],
    })),
  };
}

/**
 * Which weeks are finished.
 *
 * A week with no games at all is not settled: an unplayed week and a week everybody
 * scored zero in are both rows of zeros, and only this flag tells them apart.
 */
export function settledByWeek(
  games: readonly Game[],
  weekCount: number,
): { week: number; settled: boolean }[] {
  const byWeek = groupGamesByWeek(games);
  return Array.from({ length: weekCount }, (_, index) => {
    const week = index + 1;
    const weekGames = byWeek.get(week) ?? [];
    return {
      week,
      settled: weekGames.length > 0 && weekGames.every((game) => game.status === 'final'),
    };
  });
}
