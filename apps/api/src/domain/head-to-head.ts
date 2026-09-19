import type { HeadToHead } from '@gridiron/contracts';
import type { Membership } from '../data/leagues';
import { listMembers } from '../data/leagues';
import { loadGames, loadLeaguePicks } from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { settledByWeek } from './history';
import { scoreMembers, type ScoredMember } from './standings';

function toLine(member: ScoredMember): HeadToHead['a'] {
  return {
    memberId: member.memberId,
    displayName: member.displayName,
    points: [...member.weekly],
    seasonPoints: member.seasonPoints,
  };
}

/**
 * Two members, compared week by week.
 *
 * Ships exactly the two rows and their per-week totals — never a pick, and never the
 * rest of the league. A "win" is the higher score in a settled week, so the record
 * reads as a head-to-head season the two players happened to play against each other.
 */
export async function buildHeadToHead(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
  aMemberId: number,
  bMemberId: number,
): Promise<HeadToHead> {
  if (aMemberId === bMemberId) throw badRequest('choose two different players');

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

  const a = scored.find((member) => member.memberId === aMemberId);
  const b = scored.find((member) => member.memberId === bMemberId);
  if (a === undefined || b === undefined) throw notFound('player not found');

  const weeks = settledByWeek(games, season.weekCount);
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const week of weeks) {
    if (!week.settled) continue;
    const aPoints = a.weekly[week.week - 1] ?? 0;
    const bPoints = b.weekly[week.week - 1] ?? 0;
    if (aPoints > bPoints) aWins += 1;
    else if (bPoints > aPoints) bWins += 1;
    else ties += 1;
  }

  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    weeks,
    a: toLine(a),
    b: toLine(b),
    record: { aWins, bWins, ties },
  };
}
