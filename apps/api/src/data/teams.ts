import { teamAliases, teams } from '@gridiron/schema';
import type { Db } from '../deps';

export interface TeamRow {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly shortName: string;
}

/**
 * The 32 teams, plus every alternate spelling, held in memory.
 *
 * The API speaks canonical codes (`KC`) while the database stores row ids, so nearly
 * every request needs this translation. It is seed data — changed only by a migration
 * and a redeploy — so it is loaded once per process rather than joined on every query.
 *
 * Resolution goes through `team_aliases`, which is the same path the importer uses.
 * Neither side hardcodes that the spreadsheet writes `ARZ` where ESPN writes `ARI`.
 */
export class TeamCatalog {
  private readonly byId: ReadonlyMap<number, TeamRow>;
  private readonly byToken: ReadonlyMap<string, TeamRow>;

  private constructor(byId: ReadonlyMap<number, TeamRow>, byToken: ReadonlyMap<string, TeamRow>) {
    this.byId = byId;
    this.byToken = byToken;
  }

  static async load(db: Db): Promise<TeamCatalog> {
    const rows = await db.select().from(teams);
    const aliases = await db.select().from(teamAliases);

    const byId = new Map<number, TeamRow>();
    const byToken = new Map<string, TeamRow>();
    for (const row of rows) {
      const team: TeamRow = {
        id: row.id,
        code: row.code,
        name: row.name,
        shortName: row.shortName,
      };
      byId.set(team.id, team);
      byToken.set(normalise(team.code), team);
    }
    for (const alias of aliases) {
      const team = byId.get(alias.teamId);
      if (team !== undefined) byToken.set(normalise(alias.alias), team);
    }
    return new TeamCatalog(byId, byToken);
  }

  /**
   * The canonical code for a row id.
   *
   * Throws rather than returning a placeholder: an id that isn't in the catalog means
   * a foreign key pointed somewhere impossible, and silently rendering `UNK` would
   * turn that into a wrong pick on someone's screen.
   */
  codeFor(id: number): string {
    const team = this.byId.get(id);
    if (team === undefined) throw new Error(`unknown team id ${String(id)}`);
    return team.code;
  }

  /** Resolve any spelling — canonical, spreadsheet, or ESPN — to a team. */
  resolve(token: string): TeamRow | undefined {
    return this.byToken.get(normalise(token));
  }

  get codes(): readonly string[] {
    return [...this.byId.values()].map((team) => team.code).toSorted();
  }
}

/** Aliases are stored upper-cased and trimmed; the sheet contains at least one `"KC "`. */
function normalise(token: string): string {
  return token.trim().toUpperCase();
}
