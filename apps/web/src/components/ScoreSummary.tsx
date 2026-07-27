import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { WeekScore } from '@gridiron/contracts';
import { MAX_WEEK_SCORE } from '@gridiron/rules';

export interface ScoreSummaryProps {
  readonly weekScore: WeekScore;
  readonly seasonPoints: number;
  readonly rank: number | undefined;
  readonly memberCount: number;
}

/**
 * This week and the season, in four numbers.
 *
 * The Trifecta gets called out by name rather than folded into a total: it's the two
 * bonus points for sweeping all three, and it's what people brag about.
 */
export function ScoreSummary({ weekScore, seasonPoints, rank, memberCount }: ScoreSummaryProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={3} alignItems="center" flexWrap="wrap" useFlexGap>
        <Figure
          label={weekScore.settled ? 'This week' : 'This week so far'}
          value={`${String(weekScore.total)} / ${String(MAX_WEEK_SCORE)}`}
        />
        <Figure label="Season" value={String(seasonPoints)} />
        {rank !== undefined && (
          <Figure label="Rank" value={`${String(rank)} of ${String(memberCount)}`} />
        )}
        {weekScore.trifecta > 0 && (
          <Chip label="Trifecta +2" color="secondary" sx={{ fontWeight: 700 }} />
        )}
      </Stack>
    </Paper>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h2">{value}</Typography>
    </Box>
  );
}
