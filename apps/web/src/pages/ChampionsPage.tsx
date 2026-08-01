import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { championsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { ChampionsBoard } from '../components/ChampionsBoard';

/**
 * Everyone who has ever won it.
 *
 * The list predates the app by eighteen years — it comes from the `Grid Iron Winners`
 * sheet the commissioner has copied forward since 2007 — so most of these names have
 * no account behind them, and that is fine. They won.
 */
export function ChampionsPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const champions = useQuery(championsQuery(Number(leagueId)));

  if (champions.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (champions.isError) {
    return <Alert severity="error">{errorMessage(champions.error)}</Alert>;
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Regular-season champions since 2007, and the playoff pool that has run alongside it since
        2012.
      </Typography>
      <ChampionsBoard pools={champions.data.pools} />
    </Stack>
  );
}
