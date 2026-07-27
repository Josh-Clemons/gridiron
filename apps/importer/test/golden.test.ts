import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runImport, type ImportResult } from '../src/import';
import { createHarness, workbook, type Harness } from './helpers';

/**
 * The three real workbooks, with known expected output.
 *
 * These are the importer's regression fixtures. Between them they cover legacy BIFF8
 * reading, a 17-week season, a season still in progress, a missing `Grid Iron Winners`
 * sheet, a stray `Sheet1`, and every name-spelling drift the pool has produced since
 * 2007.
 *
 * Several expectations here differ from the numbers in the original plan, which drew
 * its error inventory from an arithmetic and internal-consistency pass rather than from
 * the pick rules. Where they disagree, these are the ones checked against real ESPN
 * results, and each difference is called out below.
 */
describe('golden workbooks', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function dryRun(year: 2020 | 2023 | 2025): Promise<ImportResult> {
    const leagueId = await harness.reset();
    return runImport(harness.deps, { file: workbook(year), leagueId, year, apply: false });
  }

  describe('2020 — legacy .xls, 17 weeks, no winners sheet', () => {
    let result: ImportResult;
    beforeAll(async () => {
      result = await dryRun(2020);
    });

    it('reads the legacy format and derives the week count from the header', () => {
      expect(result.weekCount).toBe(17);
      expect(result.playerCount).toBe(42);
    });

    it('resolves every name and team token', () => {
      // resolveAll and resolveCandidates throw rather than returning, so simply getting
      // a result proves both. 81 people across three workbooks reduce from 86 spellings.
      expect(result.importable).toBeGreaterThan(1600);
    });

    it('does not flag the weeks where all three teams genuinely lost', () => {
      // A 0-for-3 week is an ordinary week, not a withheld or voided pick. If these were
      // being treated as special there would be scoring findings for all six of them.
      const zeroWeekFindings = result.scoring.filter(
        (finding) => finding.kind === 'week' && finding.sheet === 0,
      );
      expect(zeroWeekFindings).toHaveLength(0);
    });

    it('reports the single real scoring error and nothing else', () => {
      // The plan expected zero. There is one: LV lost in week 11 but was credited a
      // point in the Show slot. The week total disagreeing is the same error restated.
      const slotFindings = result.scoring.filter((finding) => finding.kind === 'slot');
      expect(slotFindings).toEqual([
        expect.objectContaining({
          playerName: 'Robert Babiak Jr.',
          week: 11,
          slot: 'show',
          teamCode: 'LV',
          sheet: 1,
          computed: 0,
        }),
      ]);
    });

    it('ignores the unscored weeks the commissioner stopped filling in', () => {
      // 2020 has picks through week 13 but scores only through week 12, and weeks 14-17
      // are empty. Neither is a disagreement, so nothing past week 13 is reported.
      expect(result.scoring.every((finding) => finding.week === null || finding.week <= 13)).toBe(
        true,
      );
    });

    it('surfaces the impossible week in Selection History', () => {
      expect(result.crossCheck).toContainEqual(
        expect.objectContaining({ playerName: 'Robert Babiak Jr.', unreadable: '36' }),
      );
    });
  });

  describe('2023 — legacy .xls, 18 weeks, complete', () => {
    let result: ImportResult;
    beforeAll(async () => {
      result = await dryRun(2023);
    });

    it('reads 49 players over 18 weeks', () => {
      expect(result.weekCount).toBe(18);
      expect(result.playerCount).toBe(49);
    });

    it("rejects Ty Trenary's week 18, which names one team in all three slots", () => {
      const trenary = result.rejections.filter(
        (rejection) => rejection.playerName === 'Ty Trenary',
      );
      expect(trenary).toHaveLength(3);
      expect(
        trenary.every((rejection) => rejection.week === 18 && rejection.teamToken === 'LV'),
      ).toBe(true);
    });

    it('resolves the same player across three different spellings', () => {
      // "Ty Trenary" in 2020, "Ty Trenary IRHB" here, `Ty "IRHB" Trenary` in 2025.
      // The rejection above is filed under the canonical name, which is the proof.
      expect(result.rejections.some((rejection) => rejection.playerName === 'Ty Trenary')).toBe(
        true,
      );
    });

    it('also rejects the two other rule violations the sheet contains', () => {
      // Not in the plan's inventory, which never ran the pick rules. Julie Daly names
      // PHI twice in week 16 and again in week 17; Mark Swan reuses GB at Place.
      const byPlayer = new Map<string, number>();
      for (const rejection of result.rejections) {
        byPlayer.set(rejection.playerName, (byPlayer.get(rejection.playerName) ?? 0) + 1);
      }
      expect(byPlayer.get('Julie Daly')).toBe(2);
      expect(byPlayer.get('Mark Swan')).toBe(1);
      expect(result.rejections).toHaveLength(6);
    });

    it('reports no scoring errors', () => {
      expect(result.scoring).toEqual([]);
    });

    it('does not flag the weeks where all three teams genuinely lost', () => {
      expect(
        result.scoring.filter((finding) => finding.kind === 'week' && finding.sheet === 0),
      ).toHaveLength(0);
    });

    it("flags Pam Woodward's week logged one column off, without flagging the 99% that agree", () => {
      const woodward = result.crossCheck.filter((finding) => finding.playerName === 'Pam Woodward');
      expect(woodward).toHaveLength(3);
      expect(
        woodward.every((finding) => finding.scoresWeek === 18 && finding.historyWeek === 17),
      ).toBe(true);

      // The tab holds roughly 2,500 entries; only a handful disagree.
      expect(result.crossCheck.length).toBeLessThan(20);
    });
  });

  describe('2025 — .xlsx, 72 players, season in progress', () => {
    let result: ImportResult;
    beforeAll(async () => {
      result = await dryRun(2025);
    });

    it('reads 72 players and looks sheets up by name past the stray Sheet1', () => {
      expect(result.weekCount).toBe(18);
      expect(result.playerCount).toBe(72);
    });

    it('imports the blank weeks 17 and 18 as absent rather than as picks', () => {
      const late = result.rejections.filter((rejection) => rejection.week > 16);
      expect(late).toEqual([]);
      expect(result.scoring.filter((finding) => (finding.week ?? 0) > 16)).toEqual([]);
    });

    it('reports the mis-credited slots, including a fourth error the plan missed', () => {
      // Each root error also moves the week total and the season total, so the report
      // has more lines than errors. The slot-level findings are the errors themselves.
      //
      // The plan listed week 15 NOR as one error affecting Jesse Singh. In fact week 15
      // has *two* Show slots credited 0 for teams that won — NO for Jesse Singh and WSH
      // for Jo Dees. Both wins are confirmed in the ESPN fixture, so this is a real
      // fourth error rather than a false positive.
      const slots = result.scoring
        .filter((finding) => finding.kind === 'slot')
        .toSorted((a, b) => a.playerName.localeCompare(b.playerName));

      expect(slots).toEqual([
        expect.objectContaining({
          playerName: 'Brett May',
          week: 14,
          slot: 'win',
          teamCode: 'GB',
          sheet: 4,
          computed: 5,
        }),
        expect.objectContaining({
          playerName: 'Jesse Singh',
          week: 15,
          slot: 'show',
          teamCode: 'NO',
          sheet: 0,
          computed: 1,
        }),
        expect.objectContaining({
          playerName: 'Jo Dees',
          week: 15,
          slot: 'show',
          teamCode: 'WSH',
          sheet: 0,
          computed: 1,
        }),
      ]);

      // Brian Daly's week 16 is the remaining known error: 5+3+1 entered correctly but
      // totalled 9, dropping the Trifecta bonus. It surfaces as a week finding rather
      // than a slot one, because no individual slot was mis-credited.
      expect(result.scoring).toContainEqual(
        expect.objectContaining({
          playerName: 'Brian Daly',
          kind: 'week',
          week: 16,
          sheet: 9,
          computed: 11,
        }),
      );
    });

    it('flags the two known week-offsets in Selection History', () => {
      const passmore = result.crossCheck.filter(
        (finding) => finding.playerName === 'Kathy Passmore',
      );
      expect(
        passmore.every((finding) => finding.scoresWeek === 16 && finding.historyWeek === 17),
      ).toBe(true);
      expect(passmore.length).toBeGreaterThan(0);

      const olender = result.crossCheck.filter(
        (finding) => finding.playerName === 'Robert Olender',
      );
      expect(
        olender.every((finding) => finding.scoresWeek === 8 && finding.historyWeek === 7),
      ).toBe(true);
      expect(olender.length).toBeGreaterThan(0);
    });
  });
});
