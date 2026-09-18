import type {
  CorrectPickResponse,
  Correction,
  CorrectionsResponse,
} from '@gridiron/contracts';
import { toWireRejection } from '@gridiron/contracts';
import { validatePick, type Slot } from '@gridiron/rules';
import { listCorrections, recordCorrection, type CorrectionRow } from '../data/corrections';
import type { MemberRow, Membership } from '../data/leagues';
import {
  loadGames,
  loadMemberPicks,
  softDeletePick,
  upsertPick,
  type PickRow,
} from '../data/picks';
import type { SeasonRow } from '../data/seasons';
import type { Deps } from '../deps';
import { badRequest, forbidden, notFound, pickRejected } from '../http/errors';
import { toWirePicks, toWireWeekScore } from './board';

/**
 * Correct one slot of any member's week — the commissioner's override.
 *
 * Rule 10 (a postponed game may be substituted) and every importer rejection or
 * conflict eventually lands here. What makes this different from `putPick`:
 *
 * - it acts on the *target* member's picks, not the caller's — the route has already
 *   established that the caller owns the league, and re-checks here so the domain
 *   function cannot be called without it;
 * - it ignores the kickoff lock, which is the entire point: corrections happen after
 *   games have started, been postponed, or been mis-transcribed;
 * - it enforces every *other* rule through the same `validatePick` as always. A
 *   correction that breaks the season-reuse rule or takes both sides of one game is
 *   not a correction, it is a new mistake;
 * - the pick write and its audit row go in one transaction. A pick changed with no
 *   record of why is worse than either half alone.
 */
export async function correctPick(
  deps: Deps,
  actor: Membership,
  target: MemberRow,
  season: SeasonRow,
  week: number,
  slot: Slot,
  teamCode: string | null,
  reason: string,
): Promise<CorrectPickResponse> {
  if (actor.role !== 'owner') throw forbidden('only the owner can do that');
  if (actor.archivedAt !== null) throw forbidden('this league is archived');

  const catalog = await deps.teams();
  const [weekGames, seasonPicks] = await Promise.all([
    loadGames(deps, season.id, week),
    loadMemberPicks(deps, target.id, season.id),
  ]);

  const existing = seasonPicks.find((pick) => pick.week === week && pick.slot === slot);
  const fromCode = existing?.teamId ?? null;
  const fromId = existing === undefined ? null : catalog.resolve(existing.teamId)?.id ?? null;
  const now = deps.now();

  let toCode: string | null = null;
  let toId: number | null = null;
  if (teamCode !== null) {
    const team = catalog.resolve(teamCode);
    if (team === undefined) throw badRequest('unknown team', { teamId: teamCode });
    if (team.code === fromCode) throw badRequest('that slot already holds that team');
    toCode = team.code;
    toId = team.id;

    const result = validatePick({
      seasonPicks,
      games: weekGames,
      week,
      slot,
      teamId: toCode,
      now,
      ignoreLock: true,
    });
    if (!result.ok) throw pickRejected(result.rejections.map(toWireRejection));
  } else if (existing === undefined) {
    // Clearing an empty slot is not an act: nothing changes, so nothing is logged.
    throw notFound('no pick in that slot');
  }

  const outcome = await deps.db.transaction(async (tx) => {
    let updated: PickRow[];
    let saved: PickRow | null = null;

    if (toCode === null) {
      await softDeletePick(tx, target.id, season.id, week, slot, now);
      updated = seasonPicks.filter((pick) => !(pick.week === week && pick.slot === slot));
    } else {
      saved = await upsertPick(
        tx,
        catalog,
        {
          memberId: target.id,
          seasonId: season.id,
          week,
          slot,
          teamCode: toCode,
          source: 'correction',
        },
        now,
      );
      updated = [
        ...seasonPicks.filter((pick) => !(pick.week === week && pick.slot === slot)),
        saved,
      ];
    }

    const audit = await recordCorrection(tx, {
      leagueId: actor.leagueId,
      actorMemberId: actor.memberId,
      targetMemberId: target.id,
      seasonId: season.id,
      week,
      slot,
      fromTeamId: fromId,
      toTeamId: toId,
      reason,
    });
    return { updated, saved, audit };
  });

  const wirePick =
    toCode === null
      ? undefined
      : toWirePicks(week, outcome.updated, weekGames, now).find((pick) => pick.slot === slot);

  const correction: Correction = {
    id: outcome.audit.id,
    actorMemberId: actor.memberId,
    actorName: actor.displayName,
    targetMemberId: target.id,
    targetName: target.displayName,
    season: season.year,
    week,
    slot,
    fromTeamId: fromCode,
    toTeamId: toCode,
    reason,
    createdAt: outcome.audit.createdAt.toISOString(),
  };

  return {
    ...(wirePick === undefined ? {} : { pick: wirePick }),
    weekScore: toWireWeekScore(week, outcome.updated, weekGames),
    correction,
  };
}

/** A season's correction log, newest first, wire-shaped. */
export async function listCorrectionLog(
  deps: Deps,
  leagueId: number,
  season: SeasonRow,
): Promise<CorrectionsResponse> {
  const rows = await listCorrections(deps, leagueId, season);
  return {
    season: { id: season.id, year: season.year, weekCount: season.weekCount },
    corrections: rows.map((row) => toWireCorrection(row, season.year)),
  };
}

function toWireCorrection(row: CorrectionRow, seasonYear: number): Correction {
  return {
    id: row.id,
    actorMemberId: row.actorMemberId,
    actorName: row.actorName,
    targetMemberId: row.targetMemberId,
    targetName: row.targetName,
    season: seasonYear,
    week: row.week,
    slot: row.slot,
    fromTeamId: row.fromTeamId,
    toTeamId: row.toTeamId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
