export interface SeasonSeed {
  readonly year: number;
  readonly weekCount: number;
}

/**
 * Seasons we know about.
 *
 * 2020 ran 17 weeks; the NFL added a game in 2021, making it 18. The three earlier
 * years are here because complete workbooks exist for them and are used as importer
 * fixtures — 2020 is specifically the one that proves nothing hardcodes 18.
 */
export const SEASONS: readonly SeasonSeed[] = [
  { year: 2020, weekCount: 17 },
  { year: 2023, weekCount: 18 },
  { year: 2025, weekCount: 18 },
  { year: 2026, weekCount: 18 },
];
