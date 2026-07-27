import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkbookError } from './workbook';

/** Where the curated roster lives, relative to this file. */
const DEFAULT_ALIAS_PATH = join(import.meta.dirname, '..', '..', 'aliases', 'players.aliases.json');

interface RosterFile {
  readonly players?: readonly { readonly name?: unknown; readonly aliases?: unknown }[];
}

/**
 * The league roster, and the only way a spreadsheet name becomes a person.
 *
 * Matching is exact after normalisation — never fuzzy. The failure mode this guards
 * against is not "the run stops", it is "one player's picks get filed under another
 * player's name", which nothing downstream would ever catch.
 */
export class Roster {
  private readonly byNormalised: ReadonlyMap<string, string>;

  private constructor(byNormalised: ReadonlyMap<string, string>) {
    this.byNormalised = byNormalised;
  }

  static load(path: string = DEFAULT_ALIAS_PATH): Roster {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new WorkbookError(`could not read the roster at ${path}: ${detail}`);
    }

    // Narrowed by hand rather than asserted: this file is hand-edited every time a
    // player joins, so a typo in it is the expected failure, not an exotic one.
    const entries: unknown =
      typeof parsed === 'object' && parsed !== null ? (parsed as RosterFile).players : undefined;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new WorkbookError(`${path} has no "players" array`);
    }

    const byNormalised = new Map<string, string>();
    const claim = (spelling: string, canonical: string): void => {
      const key = normalisePlayerName(spelling);
      if (key === '') throw new WorkbookError(`${path}: "${canonical}" has an empty spelling`);
      const existing = byNormalised.get(key);
      // Two people sharing a spelling is unresolvable, and picking either one silently
      // would be the exact mistake this class exists to prevent.
      if (existing !== undefined && existing !== canonical) {
        throw new WorkbookError(
          `${path}: "${spelling}" is claimed by both "${existing}" and "${canonical}"`,
        );
      }
      byNormalised.set(key, canonical);
    };

    for (const entry of entries) {
      const name = entry.name;
      if (typeof name !== 'string' || name.trim() === '') {
        throw new WorkbookError(`${path}: every player needs a non-empty "name"`);
      }
      claim(name, name);
      const aliases = entry.aliases ?? [];
      if (!Array.isArray(aliases)) {
        throw new WorkbookError(`${path}: "${name}" has a non-array "aliases"`);
      }
      for (const alias of aliases) {
        if (typeof alias !== 'string') {
          throw new WorkbookError(`${path}: "${name}" has a non-string alias`);
        }
        claim(alias, name);
      }
    }

    return new Roster(byNormalised);
  }

  /** The canonical display name for a spreadsheet spelling, or `undefined` if unknown. */
  resolve(rawName: string): string | undefined {
    return this.byNormalised.get(normalisePlayerName(rawName));
  }

  get size(): number {
    return new Set(this.byNormalised.values()).size;
  }
}

/**
 * Fold away the variation that carries no meaning.
 *
 * Rookie markers, curly quotes, casing and stray whitespace all drift freely between
 * copies of the workbook and none of them distinguish two people, so absorbing them
 * here keeps the alias file down to the spellings that genuinely differ. Anything
 * beyond this — a nickname, a changed surname — stays a deliberate alias line.
 */
export function normalisePlayerName(raw: string): string {
  return raw
    .replaceAll(/®/gu, ' ')
    .replaceAll(/[‘’]/gu, "'")
    .replaceAll(/[“”]/gu, '"')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Resolve every name in one go, so the run aborts on the *complete* list.
 *
 * Failing on the first unknown name would mean the operator adds one line, re-runs,
 * and hits the next one — a slow loop over what is usually "three new players joined
 * this year".
 */
export function resolveAll(
  roster: Roster,
  rawNames: readonly string[],
  source: string,
): Map<string, string> {
  const resolved = new Map<string, string>();
  const unknown: string[] = [];

  for (const raw of rawNames) {
    const canonical = roster.resolve(raw);
    if (canonical === undefined) {
      if (!unknown.includes(raw)) unknown.push(raw);
      continue;
    }
    resolved.set(raw, canonical);
  }

  if (unknown.length > 0) {
    throw new WorkbookError(
      `${source}: ${String(unknown.length)} name(s) are not in the roster — ` +
        `add them to aliases/players.aliases.json, as a new "name" if they are new to the pool ` +
        `or as an "aliases" entry on an existing player if this is a re-spelling:\n` +
        unknown.map((name) => `  ${JSON.stringify(name)}`).join('\n'),
    );
  }

  return resolved;
}

/**
 * Resolve a name that is allowed to be a stranger.
 *
 * Champions run back to 2007 and most of the early ones — Eric Nelson in 2008, Juan
 * Soto in 2011 — never appear in a workbook we can read, so aborting on them would make
 * the winners list unloadable. `champions.member_id` is nullable for exactly this: the
 * name is recorded either way, and it links to a membership only when the person is
 * still in the pool.
 */
export function resolveIfKnown(roster: Roster, rawName: string): string | undefined {
  return roster.resolve(rawName);
}
