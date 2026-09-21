import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { LeaguePick, LeaguePickEntry, Team } from '@gridiron/contracts';
import { SLOTS, type Slot } from '@gridiron/rules';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { leaguePicksQuery, seasonsQuery, teamsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { SeasonNav } from '../components/SeasonNav';
import { WeekNav } from '../components/WeekNav';
import { teamLogoUrl } from '../lib/logos';

/**
 * What everyone picked — one row per member, so "what did Mark take?" is one glance
 * rather than a hunt through the games.
 *
 * The list holds locked picks only. That is the server's decision, not this page's:
 * a pick that hasn't kicked off never travels, so there is nothing here to filter
 * and nothing that could leak a pick still open to copying. A member whose slots
 * are all still open — or simply never picked — shows three dashes, not an absence.
 */
export function LeaguePicksPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const search = useSearch({ from: '/_authed/leagues/$leagueId/league-picks' });
  const navigate = useNavigate();

  const leaguePicks = useQuery(leaguePicksQuery(id, search.season, search.week));
  const seasons = useQuery(seasonsQuery(id));
  const teams = useQuery(teamsQuery());

  const teamsByCode = useMemo(
    () => new Map<string, Team>((teams.data ?? []).map((team) => [team.code, team])),
    [teams.data],
  );

  if (leaguePicks.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (leaguePicks.isError) {
    return <Alert severity="error">{errorMessage(leaguePicks.error)}</Alert>;
  }

  const { season, week, entries } = leaguePicks.data;

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
            week={week}
            weekCount={season.weekCount}
            onChange={(next) => {
              void navigate({
                to: '/leagues/$leagueId/league-picks',
                params: { leagueId },
                search: { ...search, week: next },
              });
            }}
          />
          {/*
            Changing year drops the week, as on the standings page: week 14 of a
            17-week season is not week 14 of an 18-week one.
          */}
          <SeasonNav
            season={season.year}
            seasons={seasons.data ?? []}
            onChange={(year) => {
              void navigate({
                to: '/leagues/$leagueId/league-picks',
                params: { leagueId },
                search: { season: year },
              });
            }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {String(entries.length)} players · {String(season.year)}
        </Typography>
      </Stack>

      {entries.length === 0 ? (
        <Alert severity="info">This league has no members yet.</Alert>
      ) : (
        <Paper variant="outlined" sx={{ maxHeight: '70dvh', overflow: 'auto' }}>
          {entries.map((entry, index) => (
            <MemberRow
              key={entry.memberId}
              entry={entry}
              teamsByCode={teamsByCode}
              divider={index > 0}
            />
          ))}
        </Paper>
      )}
    </Stack>
  );
}

/** One member: name and rank on the left, their three slots to the right. */
function MemberRow({
  entry,
  teamsByCode,
  divider,
}: {
  readonly entry: LeaguePickEntry;
  readonly teamsByCode: ReadonlyMap<string, Team>;
  readonly divider: boolean;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{ px: 2, py: 1.25, ...(divider ? { borderTop: 1, borderColor: 'divider' } : {}) }}
    >
      <Stack direction="row" alignItems="center" spacing={1} minWidth={140} flexShrink={0}>
        <Typography variant="caption" color="text.secondary" sx={{ width: '1.75em' }}>
          {String(entry.rank)}
        </Typography>
        <Typography variant="body2" noWrap sx={{ fontWeight: entry.isSelf ? 700 : 400 }}>
          {entry.displayName}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ py: 0.25 }}>
        {SLOTS.map((slot) => {
          const pick = entry.picks.find((p) => p.slot === slot);
          return (
            <SlotCell
              key={slot}
              slot={slot}
              pick={pick}
              team={pick === undefined ? undefined : teamsByCode.get(pick.teamId)}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}

/** One of the three slots for one member: logo, code, and what it earned. */
function SlotCell({
  slot,
  pick,
  team,
}: {
  readonly slot: Slot;
  readonly pick: LeaguePick | undefined;
  readonly team: Team | undefined;
}) {
  if (pick === undefined) {
    // The slot is genuinely empty — either never picked or, for a game that has
    // kicked off, rejected by the importer. Either way it scores 0 and shows as —.
    return (
      <Stack
        alignItems="center"
        sx={{ px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}
      >
        <RemoveIcon color="disabled" sx={{ fontSize: 20 }} />
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.slot[slot].main, 0.12),
      }}
    >
      <Box
        component="img"
        src={teamLogoUrl(pick.teamId)}
        alt={team?.name ?? pick.teamId}
        sx={{ width: 20, height: 20 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {pick.teamId}
      </Typography>
      <OutcomeMark outcome={pick.outcome} points={pick.points} />
    </Stack>
  );
}

/** What the pick earned: a tick, a cross, or a quiet dash while the game runs. */
function OutcomeMark({ outcome, points }: { readonly outcome: string; readonly points: number }) {
  if (outcome === 'win') {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<CheckIcon />}
        label={String(points)}
        sx={{ '.MuiChip-iconSmall': { ml: 0.5 } }}
      />
    );
  }
  if (outcome === 'loss') {
    return <Chip size="small" color="default" variant="outlined" icon={<CloseIcon />} label="0" />;
  }
  return <Chip size="small" variant="outlined" icon={<RemoveIcon />} label="—" />;
}
