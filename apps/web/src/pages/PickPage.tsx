import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Team } from '@gridiron/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { usePickMutations } from '../api/mutations';
import { boardQuery, teamsQuery, usageQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { PickGrid } from '../components/PickGrid';
import { ScoreSummary } from '../components/ScoreSummary';
import { StandingsTable } from '../components/StandingsTable';
import { WeekNav } from '../components/WeekNav';
import { seasonPicksFrom } from '../lib/board';
import { useServerClock } from '../lib/clock';

/**
 * One week at a time.
 *
 * That's a load-bearing decision, not a simplification: 72 members over 18 weeks is
 * roughly 3,900 picks, and the old app shipped all of them on every page load. This
 * fetches one week — games, your three picks, everyone's totals as integers — and
 * week navigation is the primary interaction.
 */
export function PickPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const search = useSearch({ from: '/_authed/leagues/$leagueId/' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const board = useQuery(boardQuery(id, search.season, search.week));
  const usage = useQuery(usageQuery(id, search.season));
  const teams = useQuery(teamsQuery());

  /**
   * Land on the live week, then say so in the URL.
   *
   * The first load asks the server which week is open; from then on the week is
   * explicit, which makes the page linkable and gives every optimistic write a
   * deterministic cache key to update.
   */
  const resolvedWeek = board.data?.week;
  useEffect(() => {
    if (search.week !== undefined || resolvedWeek === undefined || board.data === undefined) return;
    queryClient.setQueryData(boardQuery(id, search.season, resolvedWeek).queryKey, board.data);
    void navigate({
      to: '/leagues/$leagueId',
      params: { leagueId },
      search: { ...search, week: resolvedWeek },
      replace: true,
    });
  }, [resolvedWeek, search, board.data, id, leagueId, navigate, queryClient]);

  const now = useServerClock(board.data?.now);

  const teamsByCode = useMemo(
    () => new Map<string, Team>((teams.data ?? []).map((team) => [team.code, team])),
    [teams.data],
  );

  const seasonPicks = useMemo(
    () => seasonPicksFrom(usage.data, board.data),
    [usage.data, board.data],
  );

  const week = search.week ?? resolvedWeek ?? 1;
  const { setPick, clearPick } = usePickMutations(id, search.season, week);

  if (board.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (board.isError) {
    return <Alert severity="error">{errorMessage(board.error)}</Alert>;
  }

  const self = board.data.standings.find((row) => row.isSelf);

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
          week={board.data.week}
          weekCount={board.data.season.weekCount}
          onChange={(next) => {
            void navigate({
              to: '/leagues/$leagueId',
              params: { leagueId },
              search: { ...search, week: next },
            });
          }}
        />
        <Typography variant="body2" color="text.secondary">
          {board.data.season.year} season
        </Typography>
      </Stack>

      <ScoreSummary
        weekScore={board.data.weekScore}
        seasonPoints={board.data.seasonPoints}
        rank={self?.rank}
        memberCount={board.data.standings.length}
      />

      {board.data.games.length === 0 ? (
        <Alert severity="info">No games are scheduled for week {board.data.week} yet.</Alert>
      ) : (
        <PickGrid
          board={board.data}
          seasonPicks={seasonPicks}
          teams={teamsByCode}
          now={now}
          onSelect={(slot, teamId) => {
            setPick.mutate({ slot, teamId });
          }}
          onClear={(slot) => {
            clearPick.mutate(slot);
          }}
        />
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Typography variant="h3">Standings</Typography>
          <Link to="/leagues/$leagueId/standings" params={{ leagueId }} search={{ ...search }}>
            See all {board.data.standings.length}
          </Link>
        </Stack>
        <StandingsTable rows={board.data.standings} week={board.data.week} compact />
      </Paper>
    </Stack>
  );
}
