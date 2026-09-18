import { leagueMembers, picks, seasons, teams } from '@gridiron/schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runImport, type ImportResult } from '../src/import';
import { buildWorkbook, type PlayerSpec } from './build-workbook';
import { createHarness, type Harness } from './helpers';

/** Drop the fields that differ between two runs by construction. */
function comparable(row: {
  week: number;
  slot: string;
  teamId: number;
  source: string;
  deletedAt: Date | null;
}): Record<string, unknown> {
  return {
    week: row.week,
    slot: row.slot,
    teamId: row.teamId,
    source: row.source,
    deletedAt: row.deletedAt,
  };
}

/**
 * Rejection, conflict and idempotency, on workbooks built to contain one mistake each.
 *
 * Every case runs against the real 2025 schedule, so "on a bye" and "both teams from
 * one game" mean what they mean in the NFL rather than what a stub says.
 */
describe('rejections, conflicts and applying', () => {
  let harness: Harness;
  let leagueId: number;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    leagueId = await harness.reset();
  });

  const YEAR = 2025;
  const WEEKS = 18;

  function sheet(...players: PlayerSpec[]): string {
    return buildWorkbook({ weekCount: WEEKS, players });
  }

  function dryRun(file: string): Promise<ImportResult> {
    return runImport(harness.deps, { file, leagueId, year: YEAR, apply: false });
  }

  function apply(file: string): Promise<ImportResult> {
    return runImport(harness.deps, { file, leagueId, year: YEAR, apply: true });
  }

  interface StoredRow {
    readonly id: number;
    readonly memberId: number;
    readonly week: number;
    readonly slot: 'win' | 'place' | 'show';
    readonly teamId: number;
    readonly source: 'app' | 'import' | 'correction';
    readonly createdAt: Date;
    readonly updatedAt: Date;
    readonly deletedAt: Date | null;
  }

  /** Every stored pick, in a shape two runs can be compared on. */
  async function storedPicks(): Promise<StoredRow[]> {
    const rows = await harness.db
      .select({
        id: picks.id,
        memberId: picks.leagueMemberId,
        week: picks.week,
        slot: picks.slot,
        teamId: picks.teamId,
        source: picks.source,
        createdAt: picks.createdAt,
        updatedAt: picks.updatedAt,
        deletedAt: picks.deletedAt,
      })
      .from(picks)
      .orderBy(picks.id);
    return rows;
  }

  describe('rule violations are rejected per pick', () => {
    it('rejects a team reused in the same slot and imports the rest of the week', async () => {
      const file = sheet({
        name: 'Ben Hoy',
        weeks: [
          { win: 'PHI', place: 'LAC', show: 'CIN' },
          // PHI again at Win — rule 6, once per slot per season.
          { win: 'PHI', place: 'BAL', show: 'DAL' },
        ],
      });

      const result = await dryRun(file);

      expect(result.rejections).toEqual([
        expect.objectContaining({ playerName: 'Ben Hoy', week: 2, slot: 'win', teamToken: 'PHI' }),
      ]);
      expect(result.rejections[0]?.reasons[0]).toMatch(/already used at Win in week 1/u);

      // The rejection is confined to its own slot: week 1 keeps all three and week 2
      // keeps the two that are fine.
      expect(result.importable).toBe(5);
    });

    it('rejects a team on a bye', async () => {
      // BUF and BAL are both idle in week 7 of 2025.
      const file = sheet({
        name: 'Ben Hoy',
        weeks: [null, null, null, null, null, null, { win: 'BUF', place: 'KC', show: 'SF' }],
      });

      const result = await dryRun(file);

      expect(result.rejections).toEqual([
        expect.objectContaining({ playerName: 'Ben Hoy', week: 7, slot: 'win', teamToken: 'BUF' }),
      ]);
      expect(result.rejections[0]?.reasons[0]).toMatch(/no game in week 7/u);
      expect(result.importable).toBe(2);
    });

    it('rejects both teams from one game', async () => {
      // DAL played at PHI in week 1.
      const file = sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'DAL', show: 'CIN' }] });

      const result = await dryRun(file);

      expect(result.rejections).toEqual([
        expect.objectContaining({
          playerName: 'Ben Hoy',
          week: 1,
          slot: 'place',
          teamToken: 'DAL',
        }),
      ]);
      expect(result.importable).toBe(2);
    });

    it('rejects a duplicate team within one week', async () => {
      const file = sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'PHI', show: 'CIN' }] });

      const result = await dryRun(file);

      expect(result.rejections).toEqual([
        expect.objectContaining({ week: 1, slot: 'place', teamToken: 'PHI' }),
      ]);
      expect(result.importable).toBe(2);
    });

    it('does not let one bad cell reduce what everyone else imports', async () => {
      const good: PlayerSpec[] = [
        { name: 'Bob Babiak', weeks: [{ win: 'LAC', place: 'CIN', show: 'IND' }] },
        { name: 'Amy Smith', weeks: [{ win: 'JAX', place: 'TB', show: 'PHI' }] },
      ];

      const clean = await dryRun(sheet(...good));
      // A number where a team code belongs — a damaged cell, not an unknown team.
      const damaged = await dryRun(
        sheet({ name: 'Ben Hoy', weeks: [{ win: 0, place: 'BAL', show: 'DAL' }] }, ...good),
      );

      expect(damaged.rejections).toEqual([
        expect.objectContaining({ playerName: 'Ben Hoy', week: 1, slot: 'win' }),
      ]);
      expect(damaged.rejections[0]?.reasons[0]).toMatch(/not a team/u);
      // Everyone else's six picks survive, plus Ben Hoy's own two good slots.
      expect(damaged.importable).toBe(clean.importable + 2);
    });
  });

  describe('conflicts with picks made in the app', () => {
    it('imports neither and leaves the app pick byte-identical', async () => {
      const [season] = await harness.db
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.year, YEAR))
        .limit(1);
      const [member] = await harness.db
        .insert(leagueMembers)
        .values({ leagueId, displayName: 'Ben Hoy', role: 'member' })
        .returning({ id: leagueMembers.id });
      const [dallas] = await harness.db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.code, 'DAL'))
        .limit(1);
      if (season === undefined || member === undefined || dallas === undefined) {
        throw new Error('fixture setup failed');
      }

      await harness.db.insert(picks).values({
        leagueMemberId: member.id,
        seasonId: season.id,
        week: 1,
        slot: 'win',
        teamId: dallas.id,
        source: 'app',
      });
      const before = await storedPicks();

      // The sheet says PHI in the slot the player already filled with DAL.
      const file = sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] });
      const result = await apply(file);

      expect(result.conflicts).toEqual([
        expect.objectContaining({
          playerName: 'Ben Hoy',
          week: 1,
          slot: 'win',
          sheetTeam: 'PHI',
          appTeam: 'DAL',
        }),
      ]);

      // Neither team is written to that slot, and the other two slots still import.
      expect(result.written.inserted).toBe(2);

      const after = await storedPicks();
      expect(after.filter((row) => row.slot === 'win')).toEqual(before);
    });

    it('leaves an app pick alone when the sheet agrees with it', async () => {
      const [season] = await harness.db
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.year, YEAR))
        .limit(1);
      const [member] = await harness.db
        .insert(leagueMembers)
        .values({ leagueId, displayName: 'Ben Hoy', role: 'member' })
        .returning({ id: leagueMembers.id });
      const [philadelphia] = await harness.db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.code, 'PHI'))
        .limit(1);
      if (season === undefined || member === undefined || philadelphia === undefined) {
        throw new Error('fixture setup failed');
      }

      await harness.db.insert(picks).values({
        leagueMemberId: member.id,
        seasonId: season.id,
        week: 1,
        slot: 'win',
        teamId: philadelphia.id,
        source: 'app',
      });

      const file = sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] });
      const result = await apply(file);

      expect(result.conflicts).toEqual([]);

      // Provenance is preserved: the player did enter this one, so it stays `app`
      // rather than being restamped as an import of the same team.
      const [stored] = await harness.db
        .select({ source: picks.source })
        .from(picks)
        .where(and(eq(picks.leagueMemberId, member.id), eq(picks.week, 1), eq(picks.slot, 'win')));
      expect(stored?.source).toBe('app');
    });

    it('leaves a commissioner correction alone when the sheet disagrees', async () => {
      const [season] = await harness.db
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.year, YEAR))
        .limit(1);
      const [member] = await harness.db
        .insert(leagueMembers)
        .values({ leagueId, displayName: 'Ben Hoy', role: 'member' })
        .returning({ id: leagueMembers.id });
      const [dallas] = await harness.db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.code, 'DAL'))
        .limit(1);
      if (season === undefined || member === undefined || dallas === undefined) {
        throw new Error('fixture setup failed');
      }

      await harness.db.insert(picks).values({
        leagueMemberId: member.id,
        seasonId: season.id,
        week: 1,
        slot: 'win',
        teamId: dallas.id,
        source: 'correction',
      });

      const result = await apply(
        sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] }),
      );

      expect(result.conflicts).toEqual([
        expect.objectContaining({
          playerName: 'Ben Hoy',
          week: 1,
          slot: 'win',
          sheetTeam: 'PHI',
          appTeam: 'DAL',
        }),
      ]);
      const [stored] = await harness.db
        .select({ source: picks.source, teamId: picks.teamId })
        .from(picks)
        .where(and(eq(picks.leagueMemberId, member.id), eq(picks.week, 1), eq(picks.slot, 'win')));
      expect(stored).toEqual({ source: 'correction', teamId: dallas.id });
    });
  });

  describe('applying', () => {
    it('creates placeholder members and writes the picks', async () => {
      const file = sheet(
        { name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] },
        { name: 'Amy Smith', weeks: [{ win: 'JAX', place: 'TB', show: 'IND' }] },
      );

      const result = await apply(file);

      expect(result.membersCreated).toEqual(['Ben Hoy', 'Amy Smith']);
      expect(result.written).toEqual({ inserted: 6, updated: 0, unchanged: 0 });

      const members = await harness.db
        .select({ displayName: leagueMembers.displayName, userId: leagueMembers.userId })
        .from(leagueMembers)
        .where(eq(leagueMembers.leagueId, leagueId));
      // Not app accounts: a real registration later claims the row by setting user_id.
      expect(members.every((member) => member.userId === null)).toBe(true);
    });

    it('applying twice leaves the database identical', async () => {
      const file = sheet(
        { name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] },
        { name: 'Amy Smith', weeks: [{ win: 'JAX', place: 'TB', show: 'IND' }] },
      );

      await apply(file);
      const first = await storedPicks();

      harness.setNow(new Date('2026-02-01T00:00:00Z'));
      const second = await apply(file);

      expect(second.written).toEqual({ inserted: 0, updated: 0, unchanged: 6 });
      expect(second.membersCreated).toEqual([]);
      // Compared with the clock moved on, so a needless rewrite of `updated_at` fails.
      expect(await storedPicks()).toEqual(first);
    });

    it('soft-deletes a pick that has vanished from the sheet', async () => {
      await apply(sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC', show: 'CIN' }] }));

      // The Show slot is gone from the reissued workbook.
      const result = await apply(sheet({ name: 'Ben Hoy', weeks: [{ win: 'PHI', place: 'LAC' }] }));

      expect(result.removals).toEqual([
        expect.objectContaining({ playerName: 'Ben Hoy', week: 1, slot: 'show', teamCode: 'CIN' }),
      ]);

      const rows = await harness.db
        .select({ slot: picks.slot, deletedAt: picks.deletedAt })
        .from(picks);
      // The row survives for provenance; the partial unique indexes stop seeing it.
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.slot === 'show')?.deletedAt).not.toBeNull();
      expect(rows.filter((row) => row.deletedAt === null)).toHaveLength(2);
    });

    it('never writes the scores the sheet carries', async () => {
      // The app recomputes every score from ESPN results, so a workbook that carries
      // scores and one that carries none must land in the database identically.
      // Anything else would be a second source of truth, free to drift from the first.
      const picked = { win: 'PHI', place: 'LAC', show: 'CIN' } as const;

      await apply(
        sheet({
          name: 'Ben Hoy',
          weeks: [{ ...picked, earned: [5, 3, 1], trifecta: 2, total: 11 }],
          seasonScore: 11,
        }),
      );
      const withScores = (await storedPicks()).map(comparable);

      leagueId = await harness.reset();
      await apply(sheet({ name: 'Ben Hoy', weeks: [picked] }));
      const withoutScores = (await storedPicks()).map(comparable);

      expect(withScores).toEqual(withoutScores);
      expect(withScores).toHaveLength(3);
    });
  });

  describe('aborting', () => {
    it('refuses the whole run when a name is not in the roster', async () => {
      const file = sheet({ name: 'Nobody McStranger', weeks: [{ win: 'PHI' }] });

      await expect(dryRun(file)).rejects.toThrow(/not in the roster/u);
    });

    it('refuses the whole run when a team token is unknown', async () => {
      // A relocated franchise the alias table has never seen.
      const file = sheet({ name: 'Ben Hoy', weeks: [{ win: 'XYZ', place: 'LAC', show: 'CIN' }] });

      await expect(dryRun(file)).rejects.toThrow(/team token/u);
    });

    it('refuses a workbook whose week count disagrees with the season', async () => {
      const file = buildWorkbook({
        weekCount: 17,
        players: [{ name: 'Ben Hoy', weeks: [{ win: 'PHI' }] }],
      });

      await expect(dryRun(file)).rejects.toThrow(/17-week season but 2025/u);
    });
  });
});
