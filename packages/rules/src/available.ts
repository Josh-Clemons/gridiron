import { gamesInWeek } from './games';
import type { Game, Pick, Slot, TeamId } from './types';
import { validatePick, type PickRejection } from './validate';

export interface TeamOption {
  readonly teamId: TeamId;
  readonly opponent: TeamId;
  readonly isHome: boolean;
  readonly kickoff: Date;
  readonly selectable: boolean;
  /** Empty when `selectable`. Drives the "why not" tooltip. */
  readonly rejections: readonly PickRejection[];
}

export interface AvailableTeamsInput {
  readonly seasonPicks: readonly Pick[];
  readonly games: readonly Game[];
  readonly week: number;
  readonly slot: Slot;
  readonly now: Date;
  readonly ignoreLock?: boolean;
}

/**
 * Every team playing in a week, each annotated with whether it can go in this slot.
 *
 * Returns unavailable teams too, rather than filtering them out, so the UI can grey
 * them out with a reason instead of silently hiding them. The old app let you pick an
 * illegal team and then reverted the field behind a toast that closed in one second;
 * showing the constraint up front is the point of this function.
 *
 * Sorted by team code for a stable, scannable list.
 */
export function availableTeamsFor(input: AvailableTeamsInput): readonly TeamOption[] {
  const { seasonPicks, games, week, slot, now, ignoreLock = false } = input;
  const options: TeamOption[] = [];

  for (const game of gamesInWeek(games, week)) {
    for (const teamId of [game.homeTeam, game.awayTeam]) {
      const result = validatePick({
        seasonPicks,
        games,
        week,
        slot,
        teamId,
        now,
        ignoreLock,
      });
      options.push({
        teamId,
        opponent: teamId === game.homeTeam ? game.awayTeam : game.homeTeam,
        isHome: teamId === game.homeTeam,
        kickoff: game.kickoff,
        selectable: result.ok,
        rejections: result.ok ? [] : result.rejections,
      });
    }
  }

  return options.toSorted((a, b) => a.teamId.localeCompare(b.teamId));
}

/**
 * Teams still usable in a slot for the rest of the season (rule 6).
 *
 * This is the strategic core of the game — with each team usable once per slot, and
 * so at most three times a year, knowing what you have left is most of the decision.
 * It's what the commissioner's hand-maintained `Selection History` tab exists to
 * track; derived here, it can't drift out of sync.
 */
export function teamsRemainingForSlot(
  seasonPicks: readonly Pick[],
  slot: Slot,
  allTeams: readonly TeamId[],
): readonly TeamId[] {
  const used = new Set(seasonPicks.filter((pick) => pick.slot === slot).map((pick) => pick.teamId));
  return allTeams.filter((teamId) => !used.has(teamId));
}
