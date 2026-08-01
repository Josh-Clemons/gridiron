import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { historyQuery, seasonsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { HistoryGrid } from '../components/HistoryGrid';
import { SeasonNav } from '../components/SeasonNav';

/**
 * A finished season, week by week.
 *
 * The standings answer "who won"; this answers "how" — the week somebody swept, the
 * month somebody fell apart. It is the one view that loads a whole season at once,
 * which it can afford because every cell is a single integer.
 */
export function HistoryPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const search = useSearch({ from: '/_authed/leagues/$leagueId/history' });
  const navigate = useNavigate();

  const id = Number(leagueId);
  const history = useQuery(historyQuery(id, search.season));
  const seasons = useQuery(seasonsQuery(id));

  if (history.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (history.isError) {
    return <Alert severity="error">{errorMessage(history.error)}</Alert>;
  }

  const played = history.data.weeks.filter((week) => week.settled).length;

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
      >
        <SeasonNav
          season={history.data.season.year}
          seasons={seasons.data ?? []}
          onChange={(year) => {
            void navigate({
              to: '/leagues/$leagueId/history',
              params: { leagueId },
              search: { season: year },
            });
          }}
        />
        <Typography variant="body2" color="text.secondary">
          {history.data.rows.length} players · {played} of {history.data.weeks.length} weeks played
        </Typography>
      </Stack>

      <Paper variant="outlined">
        <HistoryGrid weeks={history.data.weeks} rows={history.data.rows} />
      </Paper>
    </Stack>
  );
}
