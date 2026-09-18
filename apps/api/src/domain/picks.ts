import type { DeletePickResponse, PutPickResponse, TeamUsage } from '@gridiron/contracts';
import { toWireRejection } from '@gridiron/contracts';
import {
  findGame,
  isLocked,
  type Slot,
  SLOTS,
  teamsRemainingForSlot,
  validatePick,
} from '@gridiron/rules';
import type { Membership } from '../data/leagues';
import { loadGames, loadMemberPicks, softDeletePick, upsertPick } from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { badRequest, forbidden, notFound, pickRejected } from '../http/errors';
import { toWirePicks, toWireWeekScore } from './board';

/**
 * Make or change one pick.
 *
 * The order here is the whole security story: the member comes from the session's
 * membership, the rules engine re-checks every rule against real schedule data, and
 * only then does anything get written. Nothing about the acting player is taken from
 * the request. A pick that fails validation is never stored — there is no "saved but
 * invalid" state anywhere in this system.
 */
export async function putPick(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
  week: number,
  slot: Slot,
  teamCode: string,
): Promise<PutPickResponse> {
  if (membership.archivedAt !== null) throw forbidden('this league is archived');

  const catalog = await deps.teams();
  const team = catalog.resolve(teamCode);
  if (team === undefined) throw badRequest('unknown team', { teamId: teamCode });

  const [weekGames, seasonPicks] = await Promise.all([
    loadGames(deps, season.id, week),
    loadMemberPicks(deps, membership.memberId, season.id),
  ]);

  const result = validatePick({
    seasonPicks,
    games: weekGames,
    week,
    slot,
    teamId: team.code,
    now: deps.now(),
  });
  if (!result.ok) throw pickRejected(result.rejections.map(toWireRejection));

  // Changing a slot whose previous game has already kicked off is the same violation
  // as making it late: the old pick is locked in, whatever the new team's kickoff is.
  const previous = seasonPicks.find((pick) => pick.week === week && pick.slot === slot);
  if (previous !== undefined) {
    const previousGame = findGame(weekGames, week, previous.teamId);
    if (previousGame !== undefined && isLocked(previousGame, deps.now())) {
      throw pickRejected([
        toWireRejection({
          code: 'game_locked',
          teamId: previous.teamId,
          kickoff: previousGame.kickoff,
        }),
      ]);
    }
  }

  const saved = await upsertPick(
    deps.db,
    catalog,
    {
      memberId: membership.memberId,
      seasonId: season.id,
      week,
      slot,
      teamCode: team.code,
      source: 'app',
    },
    deps.now(),
  );

  const updated = [
    ...seasonPicks.filter((pick) => !(pick.week === week && pick.slot === slot)),
    saved,
  ];
  const wire = toWirePicks(week, updated, weekGames, deps.now()).find((pick) => pick.slot === slot);
  if (wire === undefined) throw new Error('saved pick missing from week view');

  return { pick: wire, weekScore: toWireWeekScore(week, updated, weekGames) };
}

/** Clear a slot. Locked picks stay locked — you cannot un-pick a game in progress. */
export async function clearPick(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
  week: number,
  slot: Slot,
): Promise<DeletePickResponse> {
  if (membership.archivedAt !== null) throw forbidden('this league is archived');

  const [weekGames, seasonPicks] = await Promise.all([
    loadGames(deps, season.id, week),
    loadMemberPicks(deps, membership.memberId, season.id),
  ]);

  const existing = seasonPicks.find((pick) => pick.week === week && pick.slot === slot);
  if (existing === undefined) throw notFound('no pick in that slot');

  const game = findGame(weekGames, week, existing.teamId);
  if (game !== undefined && isLocked(game, deps.now())) {
    throw pickRejected([
      toWireRejection({ code: 'game_locked', teamId: existing.teamId, kickoff: game.kickoff }),
    ]);
  }

  await softDeletePick(deps.db, membership.memberId, season.id, week, slot, deps.now());

  const remaining = seasonPicks.filter((pick) => !(pick.week === week && pick.slot === slot));
  return { weekScore: toWireWeekScore(week, remaining, weekGames) };
}

/**
 * What is left in each slot for the rest of the season.
 *
 * A team can be used once per slot and so at most three times a year, which makes
 * this the strategic heart of the game — the reason the commissioner keeps a
 * hand-written `Selection History` tab. Derived from the picks themselves, so unlike
 * his it cannot fall out of step.
 */
export async function buildUsage(
  deps: Deps,
  membership: Membership,
  season: SeasonRow,
): Promise<TeamUsage> {
  const catalog = await deps.teams();
  const seasonPicks = await loadMemberPicks(deps, membership.memberId, season.id);

  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    slots: SLOTS.map((slot) => ({
      slot,
      used: seasonPicks
        .filter((pick) => pick.slot === slot)
        .map((pick) => ({ teamId: pick.teamId, week: pick.week }))
        .toSorted((a, b) => a.week - b.week),
      remaining: [...teamsRemainingForSlot(seasonPicks, slot, catalog.codes)],
    })),
  };
}
