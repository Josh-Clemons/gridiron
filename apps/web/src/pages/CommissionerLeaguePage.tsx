import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { leagueQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { CommissionerSettings } from '../components/CommissionerSettings';

/** League settings on their own page: rename, invite code, archive/roll-forward. */
export function CommissionerLeaguePage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const league = useQuery(leagueQuery(id));

  if (league.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (league.isError) {
    return <Alert severity="error">{errorMessage(league.error)}</Alert>;
  }

  return <CommissionerSettings league={league.data} />;
}
