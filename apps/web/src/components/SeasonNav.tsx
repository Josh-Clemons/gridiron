import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { SeasonSummary } from '@gridiron/contracts';

export interface SeasonNavProps {
  readonly season: number;
  readonly seasons: readonly SeasonSummary[];
  readonly onChange: (year: number) => void;
}

/**
 * Which year you are looking at.
 *
 * The list comes from the server rather than a range: seasons only exist once their
 * schedule is synced or a workbook is imported, and offering a year with nothing
 * behind it is just a dead end. The current season is always in the list, so this
 * doubles as the way back from the archive.
 */
export function SeasonNav({ season, seasons, onChange }: SeasonNavProps) {
  // A league with a single season has nothing to navigate between.
  if (seasons.length < 2) return null;

  return (
    <TextField
      select
      size="small"
      value={seasons.some((entry) => entry.year === season) ? season : ''}
      onChange={(event) => {
        onChange(Number(event.target.value));
      }}
      slotProps={{ htmlInput: { 'aria-label': 'Season' } }}
      sx={{ minWidth: 110 }}
    >
      {seasons.map((entry) => (
        <MenuItem key={entry.year} value={entry.year}>
          {entry.year}
        </MenuItem>
      ))}
    </TextField>
  );
}
