import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { correctMemberPick } from '../api/mutations';
import { adminMembersQuery, correctionsQuery, seasonsQuery, teamsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { CommissionerCorrection } from '../components/CommissionerCorrection';
import { useToast } from '../components/Toast';

/** Pick corrections on their own page: the correction form and its audit trail. */
export function CommissionerPicksPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const members = useQuery(adminMembersQuery(id));
  const seasons = useQuery(seasonsQuery(id));
  const teams = useQuery(teamsQuery());
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>();

  const latestSeason =
    seasons.data === undefined || seasons.data.length === 0
      ? undefined
      : Math.max(...seasons.data.map((entry) => entry.year));
  const season = selectedSeason ?? latestSeason;
  const activeMembers = members.data?.filter((member) => member.removedAt === null) ?? [];
  const corrections = useQuery(correctionsQuery(id, season));

  if (members.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (members.isError) {
    return <Alert severity="error">{errorMessage(members.error)}</Alert>;
  }

  return (
    <>
      {teams.isError && <Alert severity="error">{errorMessage(teams.error)}</Alert>}
      <CommissionerCorrection
        leagueId={id}
        members={activeMembers}
        teams={teams.data ?? []}
        seasons={seasons.data ?? []}
        season={season}
        corrections={corrections.data?.corrections ?? []}
        correctionsLoading={corrections.isPending}
        correctionsError={corrections.isError ? corrections.error : undefined}
        onSeasonChange={setSelectedSeason}
        onCorrect={async (memberId, week, slot, teamId, reason) => {
          if (season === undefined) return;
          await correctMemberPick(id, memberId, season, week, slot, teamId, reason);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: correctionsQuery(id, season).queryKey }),
            queryClient.invalidateQueries({ queryKey: ['admin-member-picks', id] }),
            queryClient.invalidateQueries({ queryKey: ['board', id] }),
            queryClient.invalidateQueries({ queryKey: ['usage', id] }),
            queryClient.invalidateQueries({ queryKey: ['standings', id] }),
            queryClient.invalidateQueries({ queryKey: ['history', id] }),
          ]);
          toast.show('Pick corrected and recorded in the audit log', 'success');
        }}
      />
    </>
  );
}
