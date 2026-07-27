import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { standingsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { StandingsTable } from '../components/StandingsTable';
import { WeekNav } from '../components/WeekNav';

/**
 * The whole league, aggregated server-side.
 *
 * 72 rows of integers, which is the entire payload — no member's picks are sent to
 * anyone else's browser, at any point, for any reason.
 */
export function StandingsPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const search = useSearch({ from: '/_authed/leagues/$leagueId/standings' });
  const navigate = useNavigate();
  const standings = useQuery(standingsQuery(Number(leagueId), search.season, search.week));

  if (standings.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (standings.isError) {
    return <Alert severity="error">{errorMessage(standings.error)}</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
      >
        <WeekNav
          week={standings.data.week}
          weekCount={standings.data.season.weekCount}
          onChange={(next) => {
            void navigate({
              to: '/leagues/$leagueId/standings',
              params: { leagueId },
              search: { ...search, week: next },
            });
          }}
        />
        <Typography variant="body2" color="text.secondary">
          {standings.data.rows.length} players · {standings.data.season.year}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ maxHeight: '70dvh', overflow: 'auto' }}>
        <StandingsTable rows={standings.data.rows} week={standings.data.week} />
      </Paper>
    </Stack>
  );
}
