import type { StandingRow } from '@gridiron/contracts';
import { type Game, type Pick, scoreWeek } from '@gridiron/rules';
import type { PickRow } from '../data/picks';

export interface MemberRow {
  readonly id: number;
  readonly displayName: string;
  readonly userId: number | null;
}

export interface ScoreInput {
  readonly members: readonly MemberRow[];
  readonly picks: readonly PickRow[];
  readonly games: readonly Game[];
  readonly weekCount: number;
  readonly selfMemberId: number;
}

export interface StandingsInput extends ScoreInput {
  /** The week `weekPoints` reports. */
  readonly week: number;
}

/** A member's season, week by week. `weekly[0]` is week 1. */
export interface ScoredMember {
  readonly memberId: number;
  readonly displayName: string;
  readonly claimed: boolean;
  readonly isSelf: boolean;
  readonly weekly: readonly number[];
  readonly seasonPoints: number;
}

/**
 * Score every member's every week, once.
 *
 * The per-week totals are what both views are made of: the standings keep one of them
 * and the history grid keeps all of them. Computing them in one place is what stops
 * the two pages from ever disagreeing about what a week was worth.
 */
export function scoreMembers(input: ScoreInput): ScoredMember[] {
  const gamesByWeek = groupGamesByWeek(input.games);

  const picksByMember = new Map<number, Pick[]>();
  for (const pick of input.picks) {
    let list = picksByMember.get(pick.memberId);
    if (list === undefined) {
      list = [];
      picksByMember.set(pick.memberId, list);
    }
    list.push({ week: pick.week, slot: pick.slot, teamId: pick.teamId });
  }

  return input.members.map((member) => {
    const memberPicks = picksByMember.get(member.id) ?? [];
    const weekly: number[] = [];
    let seasonPoints = 0;

    for (let week = 1; week <= input.weekCount; week += 1) {
      const total = scoreWeek(week, memberPicks, gamesByWeek.get(week) ?? []).total;
      weekly.push(total);
      seasonPoints += total;
    }

    return {
      memberId: member.id,
      displayName: member.displayName,
      claimed: member.userId !== null,
      isSelf: member.id === input.selfMemberId,
      weekly,
      seasonPoints,
    };
  });
}

interface Rankable {
  readonly memberId: number;
  readonly displayName: string;
  readonly seasonPoints: number;
}

export interface Ranked<T> {
  readonly row: T;
  readonly rank: number;
}

/**
 * Order by season points and attach a rank.
 *
 * Standard competition ranking: ties share a rank and the next one skips (1, 2, 2, 4).
 * Equal totals fall back to name so the order is stable between requests rather than
 * whatever the database happened to return.
 */
export function rankMembers<T extends Rankable>(rows: readonly T[]): Ranked<T>[] {
  const sorted = rows.toSorted(
    (a, b) =>
      b.seasonPoints - a.seasonPoints ||
      a.displayName.localeCompare(b.displayName) ||
      a.memberId - b.memberId,
  );

  let rank = 0;
  let previousPoints: number | undefined;
  return sorted.map((row, index) => {
    if (previousPoints === undefined || row.seasonPoints !== previousPoints) {
      rank = index + 1;
      previousPoints = row.seasonPoints;
    }
    return { row, rank };
  });
}

/**
 * Season and single-week totals for every member.
 *
 * Computed server-side and returned as integers. The old frontend shipped every
 * member's every pick to the browser and recomputed an O(members × picks) loop inside
 * a `useEffect` on every render; at 72 members that payload alone would be megabytes.
 *
 * Scoring runs through `scoreWeek` from the rules package rather than being
 * reimplemented in SQL, so standings, the board, and the importer's reconciliation can
 * never disagree about what a week is worth.
 */
export function computeStandings(input: StandingsInput): StandingRow[] {
  return rankMembers(scoreMembers(input)).map(({ row, rank }) => ({
    memberId: row.memberId,
    displayName: row.displayName,
    claimed: row.claimed,
    isSelf: row.isSelf,
    weekPoints: row.weekly[input.week - 1] ?? 0,
    seasonPoints: row.seasonPoints,
    rank,
  }));
}

/**
 * Partition the schedule by week once.
 *
 * `scoreWeek` scans the games it is given, so handing it a whole season per member per
 * week turns standings into millions of comparisons. Pre-grouping keeps it to the ~16
 * games that could possibly match.
 */
export function groupGamesByWeek(games: readonly Game[]): Map<number, Game[]> {
  const byWeek = new Map<number, Game[]>();
  for (const game of games) {
    let list = byWeek.get(game.week);
    if (list === undefined) {
      list = [];
      byWeek.set(game.week, list);
    }
    list.push(game);
  }
  return byWeek;
}
