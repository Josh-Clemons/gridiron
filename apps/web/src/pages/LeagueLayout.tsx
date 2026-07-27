import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useLocation, useParams } from '@tanstack/react-router';
import { leagueQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { TabLink } from '../components/links';
import { useToast } from '../components/Toast';

/** The three views of a league, and the invite code that fills it. */
export function LeagueLayout() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const league = useQuery(leagueQuery(id));
  const location = useLocation();
  const toast = useToast();

  const tab = location.pathname.endsWith('/usage')
    ? 'usage'
    : location.pathname.endsWith('/standings')
      ? 'standings'
      : 'picks';

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

  const copyInvite = (): void => {
    void navigator.clipboard
      .writeText(league.data.inviteCode)
      .then(() => {
        toast.show('Invite code copied', 'success');
      })
      .catch(() => {
        toast.show(`Invite code: ${league.data.inviteCode}`, 'info');
      });
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography variant="h1" flexGrow={1} minWidth={0} noWrap>
          {league.data.name}
        </Typography>
        <Chip
          label={league.data.inviteCode}
          icon={<ContentCopyIcon />}
          onClick={copyInvite}
          variant="outlined"
          sx={{ fontFamily: 'monospace', letterSpacing: '0.15em' }}
        />
      </Stack>

      {league.data.archivedAt !== null && (
        <Alert severity="info">This season is archived — picks can no longer be changed.</Alert>
      )}

      <Tabs value={tab} variant="fullWidth">
        <TabLink label="Picks" value="picks" to="/leagues/$leagueId" params={{ leagueId }} />
        <TabLink
          label="Teams left"
          value="usage"
          to="/leagues/$leagueId/usage"
          params={{ leagueId }}
        />
        <TabLink
          label="Standings"
          value="standings"
          to="/leagues/$leagueId/standings"
          params={{ leagueId }}
        />
      </Tabs>

      <Outlet />
    </Stack>
  );
}
