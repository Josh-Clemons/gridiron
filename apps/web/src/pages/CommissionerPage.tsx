import AddModeratorIcon from '@mui/icons-material/AddModerator';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { Outlet, useLocation, useParams } from '@tanstack/react-router';
import { TabLink } from '../components/links';

/**
 * The owner's control room, split one section per route so each fetches only its own
 * data. The bare `/admin` URL redirects to the workbooks — in season, importing the
 * weekly workbook is the commissioner's bread and butter, so that's where they land.
 */
const SECTIONS = ['workbooks', 'picks', 'roster', 'league'] as const;

export function CommissionerPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const location = useLocation();
  const section = SECTIONS.find((name) => location.pathname.endsWith(`/${name}`)) ?? 'workbooks';

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <AddModeratorIcon color="primary" />
        <Box>
          <Typography variant="h2">Commissioner tools</Typography>
          <Typography variant="body2" color="text.secondary">
            Workbooks, pick corrections, roster, and league settings — one section each.
          </Typography>
        </Box>
      </Stack>

      {/*
        Sub-section tabs, in daily-use order. Unlike the league tabs there are no
        search params to carry across, so each link needs nothing but its route.
      */}
      <Tabs value={section} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
        <TabLink
          label="Workbooks"
          value="workbooks"
          to="/leagues/$leagueId/admin/workbooks"
          params={{ leagueId }}
        />
        <TabLink
          label="Picks"
          value="picks"
          to="/leagues/$leagueId/admin/picks"
          params={{ leagueId }}
        />
        <TabLink
          label="Roster"
          value="roster"
          to="/leagues/$leagueId/admin/roster"
          params={{ leagueId }}
        />
        <TabLink
          label="League"
          value="league"
          to="/leagues/$leagueId/admin/league"
          params={{ leagueId }}
        />
      </Tabs>

      <Outlet />
    </Stack>
  );
}
