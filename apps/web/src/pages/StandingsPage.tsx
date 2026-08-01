import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { seasonsQuery, standingsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { SeasonNav } from '../components/SeasonNav';
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
  const seasons = useQuery(seasonsQuery(Number(leagueId)));

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
        <Stack direction="row" alignItems="center" spacing={1}>
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
          {/*
            Changing year drops the week: week 14 of a 17-week season is a different
            week of a different schedule, and carrying it across reads as continuity
            that isn't there. Without it the server picks the season's live week.
          */}
          <SeasonNav
            season={standings.data.season.year}
            seasons={seasons.data ?? []}
            onChange={(year) => {
              void navigate({
                to: '/leagues/$leagueId/standings',
                params: { leagueId },
                search: { season: year },
              });
            }}
          />
        </Stack>
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
