import type { Game, Pick, Slot } from '@gridiron/rules';
import { describeRejection, scoreWeek, SLOTS, validatePick } from '@gridiron/rules';
import { requireLeague, requireSeason, resolveMembers, type MemberRow } from './data/league';
import type { Deps } from './data/deps';
import {
  loadGames,
  loadLeaguePicks,
  softDeletePick,
  upsertImportedPick,
  type StoredPick,
} from './data/picks';
import type { TeamCatalog } from './data/teams';
import { resolveAll, Roster } from './parse/roster';
import { parseScores, type SheetPlayer } from './parse/scores';
import { parseSelectionHistory } from './parse/selection-history';
import { readWorkbook, WorkbookError } from './parse/workbook';

// ---------------------------------------------------------------------------
// What a run produces
// ---------------------------------------------------------------------------

/** A pick the workbook holds that will not be imported. The slot is left empty. */
export interface Rejection {
  readonly playerName: string;
  readonly week: number;
  readonly slot: Slot;
  readonly teamToken: string;
  readonly reasons: readonly string[];
}

/** The slot already holds a pick the player entered themselves, for a different team. */
export interface Conflict {
  readonly playerName: string;
  readonly week: number;
  readonly slot: Slot;
  readonly sheetTeam: string;
  readonly appTeam: string;
}

/** `Selection History` records a different week for a team the main sheet also places. */
export interface CrossCheckFinding {
  readonly playerName: string;
  readonly teamCode: string;
  readonly slot: Slot;
  readonly scoresWeek: number;
  readonly historyWeek: number | null;
  /** Set instead of `historyWeek` when the cell held something unusable, e.g. `wk36`. */
  readonly unreadable?: string;
}

export type ScoringKind = 'slot' | 'trifecta' | 'week' | 'season';

/** The sheet's arithmetic disagrees with what the app computes from ESPN results. */
export interface ScoringFinding {
  readonly playerName: string;
  readonly kind: ScoringKind;
  readonly week: number | null;
  readonly slot: Slot | null;
  readonly teamCode: string | null;
  readonly sheet: number | null;
  readonly computed: number;
}

/** A previously imported pick that has vanished from the workbook. */
export interface Removal {
  readonly playerName: string;
  readonly week: number;
  readonly slot: Slot;
  readonly teamCode: string;
}

export interface ImportResult {
  readonly file: string;
  readonly leagueName: string;
  readonly year: number;
  readonly weekCount: number;
  readonly playerCount: number;
  /** Picks present in the workbook, before validation. */
  readonly picksInSheet: number;
  /** Picks that survived validation and hold no conflict — what `--apply` writes. */
  readonly importable: number;
  readonly written: {
    readonly inserted: number;
    readonly updated: number;
    readonly unchanged: number;
  };
  readonly membersCreated: readonly string[];
  readonly rejections: readonly Rejection[];
  readonly conflicts: readonly Conflict[];
  readonly crossCheck: readonly CrossCheckFinding[];
  readonly scoring: readonly ScoringFinding[];
  readonly removals: readonly Removal[];
  readonly applied: boolean;
}

export interface ImportOptions {
  readonly file: string;
  readonly leagueId: number;
  readonly year: number;
  /** Dry run unless set. Nothing is written and no members are created. */
  readonly apply: boolean;
}

/** A parsed pick, resolved to a real person and a real team. */
interface Candidate {
  readonly playerName: string;
  readonly week: number;
  readonly slot: Slot;
  readonly teamCode: string;
  /** What the sheet credited. Read to reconcile against; never imported. */
  readonly sheetEarned: number | null;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Parse, validate, reconcile, and — only with `apply` — write.
 *
 * The three read-only stages always run in full, so a dry run and the real thing
 * produce the same report. That is the whole operating model: run it, read the report,
 * run it again with `--apply`.
 */
export async function runImport(deps: Deps, options: ImportOptions): Promise<ImportResult> {
  const league = await requireLeague(deps, options.leagueId);
  const season = await requireSeason(deps, options.year);
  const catalog = await deps.teams();
  const games = await loadGames(deps, season.id);
  if (games.length === 0) {
    throw new WorkbookError(
      `season ${String(options.year)} has no games loaded — run pnpm sync schedule --season ${String(options.year)} first, ` +
        `otherwise every pick would be rejected as "team not playing"`,
    );
  }

  // ---- Stage 0: parse -----------------------------------------------------
  const workbook = readWorkbook(options.file);
  const scores = parseScores(workbook);
  if (scores.weekCount !== season.weekCount) {
    throw new WorkbookError(
      `${options.file} describes a ${String(scores.weekCount)}-week season but ${String(options.year)} ` +
        `is recorded as ${String(season.weekCount)} weeks — one of the two is wrong, so nothing was imported`,
    );
  }

  const roster = Roster.load();
  const names = resolveAll(
    roster,
    scores.players.map((player) => player.rawName),
    options.file,
  );
  const candidates = resolveCandidates(scores.players, names, catalog, options.file);

  // ---- Stage 1: validate --------------------------------------------------
  const validated = validateCandidates(scores.players, names, candidates, games, deps.now());

  // ---- Stage 2: reconcile -------------------------------------------------
  const canonicalNames = [
    ...new Set(scores.players.map((player) => names.get(player.rawName) ?? '')),
  ];
  const members = await resolveMembers(deps.db, league.id, canonicalNames, {
    create: false,
    now: deps.now(),
  });
  const stored = await loadLeaguePicks(deps.db, catalog, league.id, season.id);
  const memberNameById = new Map<number, string>();
  for (const [name, member] of members.byName)
    if (member !== null) memberNameById.set(member.id, name);

  const { conflicts, importable } = findConflicts(validated.accepted, members.byName, stored);
  const removals = findRemovals(importable, members.byName, stored, memberNameById);
  const crossCheck = crossCheckAgainstHistory(workbook, scores, names, catalog, validated.accepted);
  const scoring = compareScoring(scores, names, validated, games, season.weekCount);

  // ---- Stage 3: apply -----------------------------------------------------
  let written = { inserted: 0, updated: 0, unchanged: 0 };
  let membersCreated: readonly string[] = members.created;

  if (options.apply) {
    const applied = await applyChanges(deps, {
      leagueId: league.id,
      seasonId: season.id,
      catalog,
      canonicalNames,
      importable,
      removals,
    });
    written = applied.written;
    membersCreated = applied.membersCreated;
  }

  return {
    file: options.file,
    leagueName: league.name,
    year: season.year,
    weekCount: season.weekCount,
    playerCount: scores.players.length,
    picksInSheet: candidates.length + validated.rejections.length,
    importable: importable.length,
    written,
    membersCreated,
    rejections: validated.rejections,
    conflicts,
    crossCheck,
    scoring,
    removals,
    applied: options.apply,
  };
}

// ---------------------------------------------------------------------------
// Stage 0 — team tokens
// ---------------------------------------------------------------------------

/**
 * Turn parsed cells into picks against real people and real teams.
 *
 * An unrecognised team token aborts the run rather than becoming a per-pick rejection.
 * A token is three or four characters of the commissioner's own shorthand, so one this
 * table has never seen means a franchise moved or was renamed — a curated line in
 * `team_aliases`, not a bad cell. Guessing would silently file picks under the wrong
 * team for a whole season.
 */
function resolveCandidates(
  players: readonly SheetPlayer[],
  names: ReadonlyMap<string, string>,
  catalog: TeamCatalog,
  file: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  const unknown = new Map<string, string[]>();

  for (const player of players) {
    const playerName = names.get(player.rawName);
    if (playerName === undefined) continue;

    for (const week of player.weeks) {
      for (const pick of week.picks) {
        const team = catalog.resolve(pick.teamToken);
        if (team === undefined) {
          const where = unknown.get(pick.teamToken) ?? [];
          where.push(`${playerName} week ${String(pick.week)} ${pick.slot}`);
          unknown.set(pick.teamToken, where);
          continue;
        }
        candidates.push({
          playerName,
          week: pick.week,
          slot: pick.slot,
          teamCode: team.code,
          sheetEarned: pick.earned,
        });
      }
    }
  }

  if (unknown.size > 0) {
    const detail = [...unknown]
      .map(
        ([token, where]) =>
          `  ${JSON.stringify(token)} (${String(where.length)}×, e.g. ${where[0] ?? ''})`,
      )
      .join('\n');
    throw new WorkbookError(
      `${file}: ${String(unknown.size)} team token(s) are not in team_aliases — ` +
        `add them in packages/schema/src/seed/teams.ts and re-run pnpm db:seed:\n${detail}`,
    );
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Stage 1 — validation
// ---------------------------------------------------------------------------

interface Validated {
  readonly accepted: readonly Candidate[];
  readonly rejections: readonly Rejection[];
  /** Weeks holding a rejection, keyed `player week` — their scores are not comparable. */
  readonly disturbedWeeks: ReadonlySet<string>;
}

/**
 * Run every pick through `@gridiron/rules`.
 *
 * The importer is not a privileged back door: this is the same `validatePick` the API
 * calls on a logged-in user's write. The one documented exception is the kickoff lock.
 * The workbook is a *record* of picks the commissioner collected before kickoff, not a
 * new entry, so enforcing the lock would reject the current week on any run made after
 * Thursday night — and reject every historical season outright.
 *
 * Weeks are walked in order so that, when a team is reused in a slot, the earlier week
 * keeps it and the later one is rejected.
 */
function validateCandidates(
  players: readonly SheetPlayer[],
  names: ReadonlyMap<string, string>,
  candidates: readonly Candidate[],
  games: readonly Game[],
  now: Date,
): Validated {
  const byPlayer = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const list = byPlayer.get(candidate.playerName) ?? [];
    list.push(candidate);
    byPlayer.set(candidate.playerName, list);
  }

  const accepted: Candidate[] = [];
  const rejections: Rejection[] = [];
  const disturbedWeeks = new Set<string>();

  // A cell that never held a readable team is a rejection too, so the report accounts
  // for every slot the sheet meant to fill rather than only the ones it filled legibly.
  for (const player of players) {
    const playerName = names.get(player.rawName);
    if (playerName === undefined) continue;
    for (const cell of player.malformed) {
      rejections.push({
        playerName,
        week: cell.week,
        slot: cell.slot,
        teamToken: cell.value,
        reasons: [`cell holds ${JSON.stringify(cell.value)}, which is not a team`],
      });
      disturbedWeeks.add(weekKey(playerName, cell.week));
    }
  }

  for (const [playerName, picks] of byPlayer) {
    const seasonPicks: Pick[] = [];
    const ordered = picks.toSorted(
      (a, b) => a.week - b.week || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot),
    );

    for (const candidate of ordered) {
      const result = validatePick({
        seasonPicks,
        games,
        week: candidate.week,
        slot: candidate.slot,
        teamId: candidate.teamCode,
        now,
        ignoreLock: true,
      });

      if (!result.ok) {
        rejections.push({
          playerName,
          week: candidate.week,
          slot: candidate.slot,
          teamToken: candidate.teamCode,
          reasons: result.rejections.map(describeRejection),
        });
        disturbedWeeks.add(weekKey(playerName, candidate.week));
        continue;
      }

      seasonPicks.push({ week: candidate.week, slot: candidate.slot, teamId: candidate.teamCode });
      accepted.push(candidate);
    }
  }

  return { accepted, rejections, disturbedWeeks };
}

function weekKey(playerName: string, week: number): string {
  return `${playerName} ${String(week)}`;
}

// ---------------------------------------------------------------------------
// Stage 2 — reconciliation
// ---------------------------------------------------------------------------

function slotKey(memberId: number, week: number, slot: Slot): string {
  return `${String(memberId)} ${String(week)} ${slot}`;
}

/**
 * Drop picks whose slot the player already filled in the app with a different team.
 *
 * Neither side is imported and the app pick is left exactly as it was. A commissioner
 * transcribing from paper should never silently overwrite what a player entered
 * themselves — the two disagreeing is a question for a human, not for a merge rule.
 */
function findConflicts(
  accepted: readonly Candidate[],
  members: ReadonlyMap<string, MemberRow | null>,
  stored: readonly StoredPick[],
): { readonly conflicts: Conflict[]; readonly importable: Candidate[] } {
  const storedBySlot = new Map<string, StoredPick>();
  for (const pick of stored) storedBySlot.set(slotKey(pick.memberId, pick.week, pick.slot), pick);

  const conflicts: Conflict[] = [];
  const importable: Candidate[] = [];

  for (const candidate of accepted) {
    const member = members.get(candidate.playerName) ?? null;
    if (member === null) {
      // No membership yet, so nothing can conflict. On a dry run this is every pick
      // belonging to a player who would be created.
      importable.push(candidate);
      continue;
    }

    const existing = storedBySlot.get(slotKey(member.id, candidate.week, candidate.slot));
    if (
      existing !== undefined &&
      existing.source === 'app' &&
      existing.teamId !== candidate.teamCode
    ) {
      conflicts.push({
        playerName: candidate.playerName,
        week: candidate.week,
        slot: candidate.slot,
        sheetTeam: candidate.teamCode,
        appTeam: existing.teamId,
      });
      continue;
    }

    // An app pick for the *same* team is left alone rather than restamped as imported:
    // the player did enter it, and the provenance is worth keeping accurate.
    if (existing !== undefined && existing.source === 'app') continue;

    importable.push(candidate);
  }

  return { conflicts, importable };
}

/**
 * Previously imported picks that are no longer in the workbook.
 *
 * Only `import`-sourced rows are considered: a pick the player made in the app is not
 * "missing from the sheet", it was never in it.
 */
function findRemovals(
  importable: readonly Candidate[],
  members: ReadonlyMap<string, MemberRow | null>,
  stored: readonly StoredPick[],
  memberNameById: ReadonlyMap<number, string>,
): Removal[] {
  const wanted = new Set<string>();
  for (const candidate of importable) {
    const member = members.get(candidate.playerName) ?? null;
    if (member !== null) wanted.add(slotKey(member.id, candidate.week, candidate.slot));
  }

  const removals: Removal[] = [];
  for (const pick of stored) {
    if (pick.source !== 'import') continue;
    if (wanted.has(slotKey(pick.memberId, pick.week, pick.slot))) continue;
    removals.push({
      playerName: memberNameById.get(pick.memberId) ?? `member ${String(pick.memberId)}`,
      week: pick.week,
      slot: pick.slot,
      teamCode: pick.teamId,
    });
  }
  return removals;
}

/**
 * Compare the main sheet against `Selection History`.
 *
 * A genuine second opinion at roughly 99% agreement, and its disagreements are
 * patterned — a whole week logged one column off. Only a *conflicting* week is
 * reported: the tab is incompletely maintained, with dozens of picks missing from it
 * every year, so absence is weak evidence and never overrides the main sheet.
 */
function crossCheckAgainstHistory(
  workbook: ReturnType<typeof readWorkbook>,
  scores: { readonly weekCount: number },
  names: ReadonlyMap<string, string>,
  catalog: TeamCatalog,
  accepted: readonly Candidate[],
): CrossCheckFinding[] {
  if (!workbook.has('Selection History')) return [];
  const history = parseSelectionHistory(workbook, scores.weekCount);

  // (player, team, slot) -> week, as the tab records it.
  const historyWeeks = new Map<string, number>();
  const findings: CrossCheckFinding[] = [];

  for (const player of history.players) {
    const playerName = names.get(player.rawName) ?? undefined;
    if (playerName === undefined) continue;

    for (const entry of player.entries) {
      const team = catalog.resolve(entry.teamToken);
      if (team === undefined) continue;
      historyWeeks.set(`${playerName} ${team.code} ${entry.slot}`, entry.week);
    }
    for (const cell of player.unreadable) {
      const team = catalog.resolve(cell.teamToken);
      findings.push({
        playerName,
        teamCode: team?.code ?? cell.teamToken,
        slot: cell.slot,
        scoresWeek: 0,
        historyWeek: null,
        unreadable: cell.value,
      });
    }
  }

  for (const candidate of accepted) {
    const key = `${candidate.playerName} ${candidate.teamCode} ${candidate.slot}`;
    const historyWeek = historyWeeks.get(key);
    if (historyWeek === undefined || historyWeek === candidate.week) continue;
    findings.push({
      playerName: candidate.playerName,
      teamCode: candidate.teamCode,
      slot: candidate.slot,
      scoresWeek: candidate.week,
      historyWeek,
    });
  }

  return findings;
}

/**
 * Compare the sheet's arithmetic against the app's own scoring.
 *
 * The app's numbers always win — these are read purely to surface the commissioner's
 * transcription slips, which run at a couple of cells a season. Weeks holding a
 * rejected pick are skipped: the sheet credited a pick we refused, so a disagreement
 * there is the rejection restated, not a new finding.
 */
function compareScoring(
  scores: { readonly players: readonly SheetPlayer[] },
  names: ReadonlyMap<string, string>,
  validated: Validated,
  games: readonly Game[],
  weekCount: number,
): ScoringFinding[] {
  const acceptedByPlayer = new Map<string, Pick[]>();
  for (const candidate of validated.accepted) {
    const list = acceptedByPlayer.get(candidate.playerName) ?? [];
    list.push({ week: candidate.week, slot: candidate.slot, teamId: candidate.teamCode });
    acceptedByPlayer.set(candidate.playerName, list);
  }

  const findings: ScoringFinding[] = [];

  for (const player of scores.players) {
    const playerName = names.get(player.rawName);
    if (playerName === undefined) continue;
    const picks = acceptedByPlayer.get(playerName) ?? [];

    let computedSeason = 0;
    let sheetSeason = 0;
    let seasonComparable = true;

    for (let week = 1; week <= weekCount; week += 1) {
      const sheetWeek = player.weeks[week - 1];
      const score = scoreWeek(week, picks, games);
      computedSeason += score.total;
      sheetSeason += sheetWeek?.total ?? 0;

      // Nothing to compare: an empty week in the sheet is an empty week for us too.
      const filled = score.slots.some((slot) => slot.teamId !== null);
      if (!filled && (sheetWeek === undefined || sheetWeek.picks.length === 0)) continue;

      if (validated.disturbedWeeks.has(weekKey(playerName, week)) || !score.settled) {
        seasonComparable = false;
        continue;
      }

      // A week with teams but no earned values is one the commissioner never scored —
      // 2020 stops being scored after week 13, with picks still recorded. Its week
      // total then reads a literal 0, which is not a disagreement with our 11, and
      // comparing it would bury the real findings under one line per player per week.
      const sheetScored = sheetWeek?.picks.some((pick) => pick.earned !== null) ?? false;
      if (!sheetScored) {
        seasonComparable = false;
        continue;
      }

      for (const slot of score.slots) {
        if (slot.teamId === null) continue;
        const sheetPick = sheetWeek?.picks.find((pick) => pick.slot === slot.slot);
        if (sheetPick?.earned === undefined || sheetPick.earned === null) continue;
        if (sheetPick.earned !== slot.points) {
          findings.push({
            playerName,
            kind: 'slot',
            week,
            slot: slot.slot,
            teamCode: slot.teamId,
            sheet: sheetPick.earned,
            computed: slot.points,
          });
        }
      }

      if (
        sheetWeek?.trifecta !== undefined &&
        sheetWeek.trifecta !== null &&
        sheetWeek.trifecta !== score.trifecta
      ) {
        findings.push({
          playerName,
          kind: 'trifecta',
          week,
          slot: null,
          teamCode: null,
          sheet: sheetWeek.trifecta,
          computed: score.trifecta,
        });
      }

      if (
        sheetWeek?.total !== undefined &&
        sheetWeek.total !== null &&
        sheetWeek.total !== score.total
      ) {
        findings.push({
          playerName,
          kind: 'week',
          slot: null,
          teamCode: null,
          week,
          sheet: sheetWeek.total,
          computed: score.total,
        });
      }
    }

    // The season line is only worth reporting when every week fed into it was itself
    // comparable; otherwise it just repeats a week-level finding one level up.
    if (
      seasonComparable &&
      player.seasonScore !== null &&
      player.seasonScore !== computedSeason &&
      sheetSeason === player.seasonScore
    ) {
      findings.push({
        playerName,
        kind: 'season',
        week: null,
        slot: null,
        teamCode: null,
        sheet: player.seasonScore,
        computed: computedSeason,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Stage 3 — apply
// ---------------------------------------------------------------------------

interface ApplyInput {
  readonly leagueId: number;
  readonly seasonId: number;
  readonly catalog: TeamCatalog;
  readonly canonicalNames: readonly string[];
  readonly importable: readonly Candidate[];
  readonly removals: readonly Removal[];
}

/**
 * Write the surviving picks, in one transaction.
 *
 * Scores are never written — the app recomputes them from ESPN results, so storing the
 * sheet's numbers would create a second source of truth that could drift. Re-running
 * the same workbook is a no-op.
 */
async function applyChanges(
  deps: Deps,
  input: ApplyInput,
): Promise<{
  readonly written: { inserted: number; updated: number; unchanged: number };
  readonly membersCreated: readonly string[];
}> {
  const now = deps.now();

  return deps.db.transaction(async (tx) => {
    const members = await resolveMembers(tx, input.leagueId, input.canonicalNames, {
      create: true,
      now,
    });

    const written = { inserted: 0, updated: 0, unchanged: 0 };
    for (const candidate of input.importable) {
      const member = members.byName.get(candidate.playerName) ?? null;
      if (member === null)
        throw new Error(`no member for "${candidate.playerName}" after creation`);

      const outcome = await upsertImportedPick(
        tx,
        input.catalog,
        {
          memberId: member.id,
          seasonId: input.seasonId,
          week: candidate.week,
          slot: candidate.slot,
          teamCode: candidate.teamCode,
        },
        now,
      );
      written[outcome] += 1;
    }

    for (const removal of input.removals) {
      const member = members.byName.get(removal.playerName) ?? null;
      if (member === null) continue;
      await softDeletePick(tx, member.id, input.seasonId, removal.week, removal.slot, now);
    }

    return { written, membersCreated: members.created };
  });
}
