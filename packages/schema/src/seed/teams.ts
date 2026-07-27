export interface TeamSeed {
  readonly code: string;
  readonly name: string;
  readonly shortName: string;
  /**
   * Alternate spellings. The canonical code is added automatically, so list only the
   * differences: the commissioner's spreadsheet spellings and relocated franchises.
   */
  readonly aliases: readonly string[];
}

/**
 * The 32 teams, canonicalised on ESPN's codes because that's where schedule and result
 * data comes from.
 *
 * Aliases cover two sources of drift:
 *   - the spreadsheet writes ARZ, NOR and WAS where ESPN writes ARI, NO and WSH
 *   - the workbook lineage runs back to 2007, so old files carry OAK, SD and STL
 */
export const TEAMS: readonly TeamSeed[] = [
  { code: 'ARI', name: 'Arizona Cardinals', shortName: 'Cardinals', aliases: ['ARZ', 'PHX'] },
  { code: 'ATL', name: 'Atlanta Falcons', shortName: 'Falcons', aliases: [] },
  { code: 'BAL', name: 'Baltimore Ravens', shortName: 'Ravens', aliases: [] },
  { code: 'BUF', name: 'Buffalo Bills', shortName: 'Bills', aliases: [] },
  { code: 'CAR', name: 'Carolina Panthers', shortName: 'Panthers', aliases: [] },
  { code: 'CHI', name: 'Chicago Bears', shortName: 'Bears', aliases: [] },
  { code: 'CIN', name: 'Cincinnati Bengals', shortName: 'Bengals', aliases: [] },
  { code: 'CLE', name: 'Cleveland Browns', shortName: 'Browns', aliases: [] },
  { code: 'DAL', name: 'Dallas Cowboys', shortName: 'Cowboys', aliases: [] },
  { code: 'DEN', name: 'Denver Broncos', shortName: 'Broncos', aliases: [] },
  { code: 'DET', name: 'Detroit Lions', shortName: 'Lions', aliases: [] },
  { code: 'GB', name: 'Green Bay Packers', shortName: 'Packers', aliases: ['GNB'] },
  { code: 'HOU', name: 'Houston Texans', shortName: 'Texans', aliases: [] },
  { code: 'IND', name: 'Indianapolis Colts', shortName: 'Colts', aliases: [] },
  { code: 'JAX', name: 'Jacksonville Jaguars', shortName: 'Jaguars', aliases: ['JAC'] },
  { code: 'KC', name: 'Kansas City Chiefs', shortName: 'Chiefs', aliases: ['KAN'] },
  { code: 'LAC', name: 'Los Angeles Chargers', shortName: 'Chargers', aliases: ['SD', 'SDG'] },
  { code: 'LAR', name: 'Los Angeles Rams', shortName: 'Rams', aliases: ['STL'] },
  { code: 'LV', name: 'Las Vegas Raiders', shortName: 'Raiders', aliases: ['OAK', 'LVR'] },
  { code: 'MIA', name: 'Miami Dolphins', shortName: 'Dolphins', aliases: [] },
  { code: 'MIN', name: 'Minnesota Vikings', shortName: 'Vikings', aliases: [] },
  { code: 'NE', name: 'New England Patriots', shortName: 'Patriots', aliases: ['NWE'] },
  { code: 'NO', name: 'New Orleans Saints', shortName: 'Saints', aliases: ['NOR'] },
  { code: 'NYG', name: 'New York Giants', shortName: 'Giants', aliases: [] },
  { code: 'NYJ', name: 'New York Jets', shortName: 'Jets', aliases: [] },
  { code: 'PHI', name: 'Philadelphia Eagles', shortName: 'Eagles', aliases: [] },
  { code: 'PIT', name: 'Pittsburgh Steelers', shortName: 'Steelers', aliases: [] },
  { code: 'SEA', name: 'Seattle Seahawks', shortName: 'Seahawks', aliases: [] },
  { code: 'SF', name: 'San Francisco 49ers', shortName: '49ers', aliases: ['SFO'] },
  { code: 'TB', name: 'Tampa Bay Buccaneers', shortName: 'Buccaneers', aliases: ['TAM'] },
  { code: 'TEN', name: 'Tennessee Titans', shortName: 'Titans', aliases: [] },
  { code: 'WSH', name: 'Washington Commanders', shortName: 'Commanders', aliases: ['WAS', 'WFT'] },
];

/** Aliases are stored normalised, because the spreadsheet contains a `"KC "`. */
export function normaliseAlias(alias: string): string {
  return alias.trim().toUpperCase();
}
