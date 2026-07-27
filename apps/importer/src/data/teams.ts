import { teamAliases, teams } from '@gridiron/schema';
import type { DbOrTx } from './deps';

export interface TeamRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

/**
 * The 32 teams and every alternate spelling, held in memory.
 *
 * This is the importer's own copy of a lookup the API also keeps. Sharing one class
 * would mean `apps/importer` importing out of `apps/api`, and the two are edited
 * independently; duplicating a thirty-line map is cheaper than coupling two apps. What
 * genuinely must not be duplicated — the pick rules — lives in `@gridiron/rules` and is
 * shared, which is the coupling that actually matters.
 *
 * Resolution goes through `team_aliases`, so the workbook's `ARZ`/`NOR`/`WAS` and
 * ESPN's `ARI`/`NO`/`WSH` land on the same team without either side hardcoding it.
 */
export class TeamCatalog {
  private readonly byId: ReadonlyMap<number, TeamRow>;
  private readonly byToken: ReadonlyMap<string, TeamRow>;

  private constructor(byId: ReadonlyMap<number, TeamRow>, byToken: ReadonlyMap<string, TeamRow>) {
    this.byId = byId;
    this.byToken = byToken;
  }

  static async load(db: DbOrTx): Promise<TeamCatalog> {
    const rows = await db.select().from(teams);
    const aliases = await db.select().from(teamAliases);

    const byId = new Map<number, TeamRow>();
    const byToken = new Map<string, TeamRow>();
    for (const row of rows) {
      const team: TeamRow = { id: row.id, code: row.code, name: row.name };
      byId.set(team.id, team);
      byToken.set(normaliseToken(team.code), team);
    }
    for (const alias of aliases) {
      const team = byId.get(alias.teamId);
      if (team !== undefined) byToken.set(normaliseToken(alias.alias), team);
    }
    return new TeamCatalog(byId, byToken);
  }

  /** Resolve any spelling — canonical, spreadsheet, or ESPN — to a team. */
  resolve(token: string): TeamRow | undefined {
    return this.byToken.get(normaliseToken(token));
  }

  /**
   * The canonical code for a row id. Throws on an unknown id: that means a foreign key
   * pointed somewhere impossible, and rendering a placeholder would turn a broken
   * reference into a wrong team in someone's pick history.
   */
  codeFor(id: number): string {
    const team = this.byId.get(id);
    if (team === undefined) throw new Error(`unknown team id ${String(id)}`);
    return team.code;
  }
}

/** Aliases are stored upper-cased and trimmed; the sheet contains at least one `"KC "`. */
function normaliseToken(token: string): string {
  return token.trim().toUpperCase();
}
