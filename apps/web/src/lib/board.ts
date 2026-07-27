import type { Board, Game as WireGame, Pick as WirePick, TeamUsage } from '@gridiron/contracts';
import type { Game, Pick } from '@gridiron/rules';

/**
 * Wire shapes into engine shapes.
 *
 * The only real difference is that timestamps travel as ISO strings and become `Date`s
 * here, at the boundary, once. `@gridiron/rules` is the same code the API runs, so
 * whatever it says about a pick in the browser is what the server will say about it.
 */
export const toRulesGames = (games: readonly WireGame[]): Game[] =>
  games.map((game) => ({
    id: String(game.id),
    week: game.week,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoff: new Date(game.kickoff),
    status: game.status,
    winner: game.winner,
  }));

export const toRulesPicks = (picks: readonly WirePick[]): Pick[] =>
  picks.map((pick) => ({ week: pick.week, slot: pick.slot, teamId: pick.teamId }));

/**
 * Every pick the player holds this season, with the open week taken from the board.
 *
 * Rule 6 — a team once per slot per season — can only be checked against the whole
 * season, and `/usage` is where that lives. But the board is the copy that moves: an
 * optimistic write lands there a beat before `/usage` is refetched. Preferring the
 * board for the week on screen means a team picked at Win a second ago is already
 * unavailable at Place, with no refetch in between.
 */
export function seasonPicksFrom(usage: TeamUsage | undefined, board: Board | undefined): Pick[] {
  const fromUsage = (usage?.slots ?? []).flatMap((entry) =>
    entry.used.map((use) => ({ week: use.week, slot: entry.slot, teamId: use.teamId })),
  );

  if (board === undefined) return fromUsage;

  return [...fromUsage.filter((pick) => pick.week !== board.week), ...toRulesPicks(board.picks)];
}
