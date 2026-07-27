import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

export interface WeekNavProps {
  readonly week: number;
  readonly weekCount: number;
  readonly onChange: (week: number) => void;
}

/**
 * Week navigation, which is the primary interaction of the whole app.
 *
 * `weekCount` comes from the season, never from a constant: the NFL played 17 weeks
 * through 2020 and 18 from 2021, and the imported history contains both.
 */
export function WeekNav({ week, weekCount, onChange }: WeekNavProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <IconButton
        aria-label="Previous week"
        disabled={week <= 1}
        onClick={() => {
          onChange(week - 1);
        }}
      >
        <ChevronLeftIcon />
      </IconButton>

      <TextField
        select
        size="small"
        value={week}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        slotProps={{ htmlInput: { 'aria-label': 'Week' } }}
        sx={{ minWidth: 110 }}
      >
        {Array.from({ length: weekCount }, (_, index) => index + 1).map((option) => (
          <MenuItem key={option} value={option}>
            Week {option}
          </MenuItem>
        ))}
      </TextField>

      <IconButton
        aria-label="Next week"
        disabled={week >= weekCount}
        onClick={() => {
          onChange(week + 1);
        }}
      >
        <ChevronRightIcon />
      </IconButton>
    </Stack>
  );
}
