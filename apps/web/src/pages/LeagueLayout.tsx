import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useRouteContext,
} from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { leagueQuery, sessionQuery, setTourSeen } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { GuidedTour } from '../components/GuidedTour';
import { TabLink } from '../components/links';
import { useToast } from '../components/Toast';
import { commissionerTourSteps, memberTourSteps } from '../lib/tour';

/** Tab keys, in the order they appear. The index route — the pick page — is the default. */
const TABS = ['usage', 'standings', 'history', 'champions', 'admin'] as const;

/** The views of a league, and the invite code that fills it. */
export function LeagueLayout() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const { user } = useRouteContext({ from: '/_authed' });
  const league = useQuery(leagueQuery(id));
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  // The tour runs once per account - the flag it sets on finish is why.
  const [tourOpen, setTourOpen] = useState(!user.hasSeenTour);
  const markTourSeen = useMutation({
    mutationFn: () => setTourSeen(true),
    onSuccess: (updated) => {
      // Keep the session cache honest, so a page or league hop doesn't replay the
      // tour within the same session.
      queryClient.setQueryData(sessionQuery().queryKey, updated);
    },
  });

  // Sub-routes (`/admin/workbooks`, `/admin/picks`, …) must keep the Commissioner tab
  // active, so the test is a path segment match rather than an exact suffix.
  const tab = TABS.find((name) => location.pathname.includes(`/${name}`)) ?? 'picks';

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

  // Commissioners are the league's owner plus platform admins; the extra tour
  // section and the Commissioner tab both follow this one predicate.
  const commissioner = league.data.role === 'owner' || user.isAdmin;
  const openWorkbooks = useCallback(() => {
    void navigate({ to: '/leagues/$leagueId/admin/workbooks', params: { leagueId } });
  }, [leagueId, navigate]);
  const steps = useMemo(
    () =>
      commissioner
        ? [...memberTourSteps, ...commissionerTourSteps(openWorkbooks)]
        : memberTourSteps,
    [commissioner, openWorkbooks],
  );

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

      {/*
        Each tab carries the current season and week across with it. Without this the
        router resets the search to `{}`, which silently drops `?season=2023` back to
        the newest season — the same tab, a different year, and no way to tell.
      */}
      <Tabs value={tab} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <TabLink
          label="Picks"
          value="picks"
          id="tour-tab-picks"
          to="/leagues/$leagueId"
          params={{ leagueId }}
          search={(prev) => prev}
        />
        <TabLink
          label="Teams left"
          value="usage"
          id="tour-tab-usage"
          to="/leagues/$leagueId/usage"
          params={{ leagueId }}
          search={(prev) => prev}
        />
        <TabLink
          label="Standings"
          value="standings"
          id="tour-tab-standings"
          to="/leagues/$leagueId/standings"
          params={{ leagueId }}
          search={(prev) => prev}
        />
        <TabLink
          label="History"
          value="history"
          id="tour-tab-history"
          to="/leagues/$leagueId/history"
          params={{ leagueId }}
          search={(prev) => prev}
        />
        {/* The honours board spans every season, so it takes no search parameters. */}
        <TabLink
          label="Champions"
          value="champions"
          id="tour-tab-champions"
          to="/leagues/$leagueId/champions"
          params={{ leagueId }}
          search={{}}
        />
        {commissioner && (
          <TabLink
            label="Commissioner"
            value="admin"
            id="tour-tab-admin"
            to="/leagues/$leagueId/admin"
            params={{ leagueId }}
          />
        )}
      </Tabs>

      {/* First visit, or "show me around again" from Settings. */}
      {tourOpen && (
        <GuidedTour
          steps={steps}
          onDone={() => {
            setTourOpen(false);
            markTourSeen.mutate();
          }}
        />
      )}

      <Outlet />
    </Stack>
  );
}
