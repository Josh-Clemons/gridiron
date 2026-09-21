import type { LeaguePick, LeaguePicks } from '@gridiron/contracts';
import { type Game, isLocked, scoreWeek } from '@gridiron/rules';
import type { Membership } from '../data/leagues';
import { listMembers } from '../data/leagues';
import { loadGames, loadLeaguePicks, type PickRow } from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { groupGamesByWeek, rankMembers, scoreMembers } from './standings';

/**
 * The League Picks view: what every member holds this week, one row per member —
 * locked picks only.
 *
 * This is the one deliberate relaxation of "no member's picks ever travel": a pick
 * whose game has kicked off (rule 9) cannot be changed, so it cannot be copied. The
 * filter is server-side and fail-closed — a pick with no matching game in the week,
 * or whose game has not started, is dropped here and never reaches the wire. There
 * is no client-side filtering to get wrong.
 *
 * Rows are ordered like the standings (rank order) so the list reads top-down as
 * "the people I'm racing", and members with nothing locked yet are absent entirely.
 */
export async function buildLeaguePicks(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
  week: number,
): Promise<LeaguePicks> {
  const now = deps.now();

  const [games, leaguePicks, members] = await Promise.all([
    loadGames(deps, season.id),
    loadLeaguePicks(deps, membership.leagueId, season.id),
    listMembers(deps, membership.leagueId),
  ]);

  const weekGames = groupGamesByWeek(games).get(week) ?? [];

  const ranked = rankMembers(
    scoreMembers({
      members,
      picks: leaguePicks,
      games,
      weekCount: season.weekCount,
      selfMemberId: membership.memberId,
    }),
  );

  const entries = ranked.flatMap(({ row, rank }) => {
    const picks = lockedPicksOf(
      week,
      leaguePicks.filter((pick) => pick.memberId === row.memberId),
      weekGames,
      now,
    );
    if (picks.length === 0) return [];
    return [
      { memberId: row.memberId, displayName: row.displayName, isSelf: row.isSelf, rank, picks },
    ];
  });

  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    week,
    entries,
  };
}

/**
 * A member's visible picks for one week: every pick whose game exists in the week
 * and has kicked off.
 *
 * `scoreWeek` supplies the outcome and points — the same engine as the standings,
 * the board and the importer, so this view can never disagree with any of them
 * about what a pick is worth.
 */
function lockedPicksOf(
  week: number,
  memberPicks: readonly PickRow[],
  weekGames: readonly Game[],
  now: Date,
): LeaguePick[] {
  const score = scoreWeek(week, memberPicks, weekGames);

  const result: LeaguePick[] = [];
  for (const pick of memberPicks.filter((candidate) => candidate.week === week)) {
    const game = weekGames.find(
      (candidate) => candidate.homeTeam === pick.teamId || candidate.awayTeam === pick.teamId,
    );
    // No matching game, or the game has not kicked off: invisible, without exception.
    if (game === undefined || !isLocked(game, now)) continue;

    const slotScore = score.slots.find((entry) => entry.slot === pick.slot);
    const outcome = slotScore?.outcome ?? ('pending' as const);
    result.push({
      slot: pick.slot,
      teamId: pick.teamId,
      outcome,
      points: slotScore?.points ?? 0,
    });
  }
  return result;
}
