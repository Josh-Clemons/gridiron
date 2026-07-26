/**
 * The three weekly pick slots.
 *
 * These names are the pool's own vocabulary, borrowed from horse racing and in use
 * since 2007 — players say "Win/Place/Show", not "5/3/1". Keep them.
 */
export type Slot = 'win' | 'place' | 'show';

/** Canonical team code (e.g. 'ARI'). Spreadsheet and ESPN spellings are aliased to this. */
export type TeamId = string;

export type GameId = string;

export type GameStatus = 'scheduled' | 'final';

export interface Game {
  readonly id: GameId;
  readonly week: number;
  readonly homeTeam: TeamId;
  readonly awayTeam: TeamId;
  readonly kickoff: Date;
  readonly status: GameStatus;
  /**
   * The winning team, or `null` for a tie.
   *
   * A tie counts as a loss for both sides (rule 7), so `null` and "the other team won"
   * are scored identically. Only meaningful once `status` is `'final'`.
   */
  readonly winner: TeamId | null;
}

/**
 * A single filled slot. Slots with no selection are represented by the *absence* of a
 * pick rather than a null team, so an empty slot can never be mistaken for a real one.
 */
export interface Pick {
  readonly week: number;
  readonly slot: Slot;
  readonly teamId: TeamId;
}
