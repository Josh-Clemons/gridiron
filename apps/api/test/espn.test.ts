import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnError, parseScoreboard } from '../src/sync/espn';

/**
 * Recorded from the real endpoint, trimmed to the fields we consume.
 *
 * 2020 week 3 is here because it contains the Bengals–Eagles tie: `STATUS_FINAL` with
 * `winner: false` on both sides. Ties are the case most likely to be got wrong and the
 * hardest to wait around for — the NFL produces one or two a year.
 */
function fixture(name: string): unknown {
  const text = readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
  return JSON.parse(text) as unknown;
}

const SCHEDULED = fixture('espn-2026-week01.json');
const WITH_TIE = fixture('espn-2020-week03.json');

describe('parsing a scheduled week', () => {
  it('reads all 16 games with kickoffs and no results', () => {
    const games = parseScoreboard(SCHEDULED, { year: 2026, week: 1 });

    expect(games).toHaveLength(16);
    for (const game of games) {
      expect(game.status).toBe('scheduled');
      expect(game.winner).toBeNull();
      expect(Number.isNaN(game.kickoff.getTime())).toBe(false);
      expect(game.week).toBe(1);
      expect(game.homeTeam).not.toBe(game.awayTeam);
    }
  });

  it('keeps home and away the right way round', () => {
    const games = parseScoreboard(SCHEDULED, { year: 2026, week: 1 });
    const opener = games.find((game) => game.externalId === '401872656');

    // "New England Patriots at Seattle Seahawks" — Seattle is home.
    expect(opener).toMatchObject({ homeTeam: 'SEA', awayTeam: 'NE' });
    expect(opener?.kickoff.toISOString()).toBe('2026-09-10T00:20:00.000Z');
  });

  it('uses ESPN abbreviations, which are our canonical codes', () => {
    const games = parseScoreboard(SCHEDULED, { year: 2026, week: 1 });
    const codes = new Set(games.flatMap((game) => [game.homeTeam, game.awayTeam]));

    expect(codes.size).toBe(32);
    // The three the spreadsheet spells differently (ARZ/NOR/WAS) arrive canonical.
    expect(codes).toContain('ARI');
    expect(codes).toContain('NO');
    expect(codes).toContain('WSH');
  });
});

describe('parsing a completed week', () => {
  it('marks a tie as final with no winner', () => {
    const games = parseScoreboard(WITH_TIE, { year: 2020, week: 3 });
    const tie = games.find(
      (game) =>
        (game.homeTeam === 'PHI' && game.awayTeam === 'CIN') ||
        (game.homeTeam === 'CIN' && game.awayTeam === 'PHI'),
    );

    expect(tie).toBeDefined();
    expect(tie?.status).toBe('final');
    // Null, not "nobody" and not a coin flip. Rule 7 makes this a loss for both.
    expect(tie?.winner).toBeNull();
  });

  it('names the winner of every decided game', () => {
    const games = parseScoreboard(WITH_TIE, { year: 2020, week: 3 });
    const decided = games.filter((game) => game.winner !== null);

    expect(games).toHaveLength(16);
    expect(decided).toHaveLength(15);
    for (const game of decided) {
      expect(game.status).toBe('final');
      expect([game.homeTeam, game.awayTeam]).toContain(game.winner);
    }
  });
});

describe('failing loudly', () => {
  it('refuses an empty week rather than treating it as no games', () => {
    // The realistic failure mode: parameters change meaning and the endpoint starts
    // returning nothing. Wiping a week's schedule would void everyone's picks.
    expect(() => parseScoreboard({ events: [] }, { year: 2026, week: 4 })).toThrow(EspnError);
  });

  it('names the field when the shape changes', () => {
    const mangled = { events: [{ id: '1', date: '2026-09-10T00:20Z' }] };

    expect(() => parseScoreboard(mangled, { year: 2026, week: 1 })).toThrow(
      /unexpected shape for 2026 week 1/u,
    );
  });

  it('rejects a game with two winners', () => {
    const impossible = {
      events: [
        {
          id: '99',
          date: '2026-09-10T00:20Z',
          status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', winner: true, team: { abbreviation: 'KC' } },
                { homeAway: 'away', winner: true, team: { abbreviation: 'DEN' } },
              ],
            },
          ],
        },
      ],
    };

    expect(() => parseScoreboard(impossible, { year: 2026, week: 1 })).toThrow(/two winners/u);
  });

  it('rejects an unparseable kickoff', () => {
    const badDate = {
      events: [
        {
          id: '99',
          date: 'next Sunday',
          status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', team: { abbreviation: 'KC' } },
                { homeAway: 'away', team: { abbreviation: 'DEN' } },
              ],
            },
          ],
        },
      ],
    };

    expect(() => parseScoreboard(badDate, { year: 2026, week: 1 })).toThrow(/unparseable date/u);
  });
});
