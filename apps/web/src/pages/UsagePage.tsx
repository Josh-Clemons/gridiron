import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Slot as WireSlot, TeamUsage } from '@gridiron/contracts';
import { SLOT_LABELS, SLOT_POINTS } from '@gridiron/rules';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { seasonsQuery, teamsQuery, usageQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { SeasonNav } from '../components/SeasonNav';

/**
 * What you have left.
 *
 * A team can be used once per slot and so at most three times a season, which makes
 * this the strategic core of the game — it is what the commissioner keeps an entire
 * hand-maintained `Selection History` tab for, and his disagrees with his own score
 * sheet about once a season. This one is derived from the stored picks, so it cannot
 * drift.
 */
export function UsagePage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const search = useSearch({ from: '/_authed/leagues/$leagueId/usage' });
  const navigate = useNavigate();
  const usage = useQuery(usageQuery(Number(leagueId), search.season));
  const teams = useQuery(teamsQuery());
  const seasons = useQuery(seasonsQuery(Number(leagueId)));

  if (usage.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (usage.isError) {
    return <Alert severity="error">{errorMessage(usage.error)}</Alert>;
  }

  const names = new Map((teams.data ?? []).map((team) => [team.code, team.shortName]));

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="body2" color="text.secondary">
          Each team can be used once in each slot — three times a season at most, and never twice in
          the same slot.
        </Typography>
        <SeasonNav
          season={usage.data.season.year}
          seasons={seasons.data ?? []}
          onChange={(year) => {
            void navigate({
              to: '/leagues/$leagueId/usage',
              params: { leagueId },
              search: { season: year },
            });
          }}
        />
      </Stack>

      <Box
        display="grid"
        gap={2}
        gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, 1fr)' }}
        alignItems="start"
      >
        {usage.data.slots.map((entry) => (
          <SlotUsage key={entry.slot} entry={entry} names={names} />
        ))}
      </Box>
    </Stack>
  );
}

function SlotUsage({
  entry,
  names,
}: {
  entry: TeamUsage['slots'][number];
  names: ReadonlyMap<string, string>;
}) {
  const slot: WireSlot = entry.slot;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} mb={1.5}>
        <Typography variant="h3" sx={{ color: `slot.${slot}.main` }}>
          {SLOT_LABELS[slot]}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {SLOT_POINTS[slot]} {SLOT_POINTS[slot] === 1 ? 'pt' : 'pts'} · {entry.remaining.length}{' '}
          left
        </Typography>
      </Stack>

      <Box display="flex" flexWrap="wrap" gap={0.75}>
        {entry.remaining.map((code) => (
          <Chip key={code} label={code} size="small" variant="outlined" title={names.get(code)} />
        ))}
      </Box>

      {entry.used.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" display="block" mt={2} mb={0.75}>
            Spent
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={0.75}>
            {entry.used.map((use) => (
              <Chip
                key={`${use.teamId}-${String(use.week)}`}
                size="small"
                label={`${use.teamId} · wk ${String(use.week)}`}
                sx={{ bgcolor: `slot.${slot}.main`, color: `slot.${slot}.contrastText` }}
              />
            ))}
          </Box>
        </>
      )}
    </Paper>
  );
}
