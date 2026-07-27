import type { Board, Game as WireGame, Pick as WirePick, WeekScore } from '@gridiron/contracts';
import { type Game, isLocked, scoreWeek, SLOTS } from '@gridiron/rules';
import type { Membership } from '../data/leagues';
import { listMembers } from '../data/leagues';
import { loadGames, loadLeaguePicks, type PickRow } from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { computeStandings, groupGamesByWeek } from './standings';

/**
 * One week of the pick page, in a single response.
 *
 * The games, the caller's own three picks, their score, and every member's totals as
 * integers — deliberately flat and deliberately one week wide. The old app's
 * equivalent nested a full user (with email), a full league (with its invite code) and
 * a full team into every pick row and shipped the whole season: 1.5–3 MB per page
 * load. This is a few kilobytes.
 */
export async function buildBoard(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
  week: number,
): Promise<Board> {
  const now = deps.now();

  const [games, leaguePicks, members] = await Promise.all([
    loadGames(deps, season.id),
    loadLeaguePicks(deps, membership.leagueId, season.id),
    listMembers(deps, membership.leagueId),
  ]);

  const gamesByWeek = groupGamesByWeek(games);
  const weekGames = gamesByWeek.get(week) ?? [];
  const myPicks = leaguePicks.filter((pick) => pick.memberId === membership.memberId);

  const standings = computeStandings({
    members,
    picks: leaguePicks,
    games,
    weekCount: season.weekCount,
    week,
    selfMemberId: membership.memberId,
  });

  const seasonPoints =
    standings.find((row) => row.memberId === membership.memberId)?.seasonPoints ?? 0;

  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    week,
    now: now.toISOString(),
    games: weekGames.map((game) => toWireGame(game, now)),
    picks: toWirePicks(week, myPicks, weekGames, now),
    weekScore: toWireWeekScore(week, myPicks, weekGames),
    seasonPoints,
    standings,
  };
}

export function toWireGame(game: Game, now: Date): WireGame {
  return {
    id: Number(game.id),
    week: game.week,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoff: game.kickoff.toISOString(),
    status: game.status,
    winner: game.winner,
    locked: isLocked(game, now),
  };
}

export function toWireWeekScore(
  week: number,
  picks: readonly PickRow[],
  weekGames: readonly Game[],
): WeekScore {
  const score = scoreWeek(week, picks, weekGames);
  return {
    week: score.week,
    base: score.base,
    trifecta: score.trifecta,
    total: score.total,
    settled: score.settled,
  };
}

/**
 * The caller's picks for a week, each carrying its own outcome, points and lock state.
 *
 * Locking is per game (rule 9) — a Thursday pick is frozen while the rest of the week
 * is still editable — so the flag is computed per pick rather than for the week.
 */
export function toWirePicks(
  week: number,
  picks: readonly PickRow[],
  weekGames: readonly Game[],
  now: Date,
): WirePick[] {
  const score = scoreWeek(week, picks, weekGames);
  const byWeekAndSlot = new Map(
    picks.filter((pick) => pick.week === week).map((pick) => [pick.slot, pick]),
  );

  const result: WirePick[] = [];
  for (const slot of SLOTS) {
    const pick = byWeekAndSlot.get(slot);
    if (pick === undefined) continue;

    const slotScore = score.slots.find((entry) => entry.slot === slot);
    const game = weekGames.find(
      (candidate) => candidate.homeTeam === pick.teamId || candidate.awayTeam === pick.teamId,
    );

    result.push({
      slot,
      week,
      teamId: pick.teamId,
      source: pick.source,
      outcome: slotScore?.outcome ?? 'pending',
      points: slotScore?.points ?? 0,
      locked: game !== undefined && isLocked(game, now),
      updatedAt: pick.updatedAt.toISOString(),
    });
  }
  return result;
}
