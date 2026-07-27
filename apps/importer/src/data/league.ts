import { leagueMembers, leagues, seasons } from '@gridiron/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalisePlayerName } from '../parse/roster';
import type { DbOrTx, Deps } from './deps';

export interface SeasonRow {
  readonly id: number;
  readonly year: number;
  readonly weekCount: number;
}

export interface LeagueRow {
  readonly id: number;
  readonly name: string;
}

export interface MemberRow {
  readonly id: number;
  readonly displayName: string;
  /** Null for a placeholder the importer created; set once a real account claims it. */
  readonly userId: number | null;
}

export async function requireSeason(deps: Deps, year: number): Promise<SeasonRow> {
  const rows = await deps.db
    .select({ id: seasons.id, year: seasons.year, weekCount: seasons.weekCount })
    .from(seasons)
    .where(eq(seasons.year, year))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      `no season ${String(year)} — add it to packages/schema/src/seed/seasons.ts, ` +
        `re-run pnpm db:seed, then pnpm sync schedule --season ${String(year)}`,
    );
  }
  return row;
}

export async function requireLeague(deps: Deps, leagueId: number): Promise<LeagueRow> {
  const rows = await deps.db
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error(`no league with id ${String(leagueId)}`);
  return row;
}

export async function loadMembers(db: DbOrTx, leagueId: number): Promise<MemberRow[]> {
  return db
    .select({
      id: leagueMembers.id,
      displayName: leagueMembers.displayName,
      userId: leagueMembers.userId,
    })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.removedAt)));
}

/**
 * Map every roster name in the workbook onto a league member, creating placeholders.
 *
 * The 72 people in the spreadsheet are not app accounts, so most memberships have no
 * user behind them — `league_members.user_id` is nullable exactly for this. Matching is
 * on the normalised display name, which means a member a real player already created by
 * registering is *reused* rather than duplicated: setting `user_id` on that row later is
 * what lets them inherit their whole imported history.
 *
 * `create` is false on a dry run, so the report can say "these 3 members would be
 * created" without writing anything.
 */
export async function resolveMembers(
  db: DbOrTx,
  leagueId: number,
  canonicalNames: readonly string[],
  options: { readonly create: boolean; readonly now: Date },
): Promise<{ readonly byName: Map<string, MemberRow | null>; readonly created: string[] }> {
  const existing = await loadMembers(db, leagueId);
  const byNormalised = new Map(
    existing.map((member) => [normalisePlayerName(member.displayName), member]),
  );

  const byName = new Map<string, MemberRow | null>();
  const created: string[] = [];

  for (const name of canonicalNames) {
    const key = normalisePlayerName(name);
    const found = byNormalised.get(key);
    if (found !== undefined) {
      byName.set(name, found);
      continue;
    }

    if (!options.create) {
      // Dry run: the member does not exist yet and won't be made. Recorded as null so
      // the caller can report the picks it *would* have imported.
      byName.set(name, null);
      created.push(name);
      continue;
    }

    const inserted = await db
      .insert(leagueMembers)
      .values({ leagueId, displayName: name, role: 'member', joinedAt: options.now })
      .returning({
        id: leagueMembers.id,
        displayName: leagueMembers.displayName,
        userId: leagueMembers.userId,
      });

    const row = inserted[0];
    if (row === undefined) throw new Error(`could not create a member for "${name}"`);
    byNormalised.set(key, row);
    byName.set(name, row);
    created.push(name);
  }

  return { byName, created };
}
