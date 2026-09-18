import AddModeratorIcon from '@mui/icons-material/AddModerator';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { AdminMember } from '@gridiron/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import {
  correctMemberPick,
  removeMember,
  renameMember,
  restoreMember,
  transferOwnership,
} from '../api/mutations';
import {
  adminMembersQuery,
  correctionsQuery,
  leagueQuery,
  seasonsQuery,
  teamsQuery,
} from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import {
  CommissionerRoster,
  MemberActionDialog,
  RenameMemberDialog,
  type MemberAction,
} from '../components/CommissionerRoster';
import { CommissionerCorrection } from '../components/CommissionerCorrection';
import { CommissionerSettings } from '../components/CommissionerSettings';
import { useToast } from '../components/Toast';

/** The owner’s control room: roster management, corrections, and their audit trail. */
export function CommissionerPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const members = useQuery(adminMembersQuery(id));
  const seasons = useQuery(seasonsQuery(id));
  const teams = useQuery(teamsQuery());
  const league = useQuery(leagueQuery(id));
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>();
  const [renameTarget, setRenameTarget] = useState<AdminMember | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [action, setAction] = useState<{ kind: MemberAction; member: AdminMember } | null>(null);

  const latestSeason =
    seasons.data === undefined || seasons.data.length === 0
      ? undefined
      : Math.max(...seasons.data.map((entry) => entry.year));
  const season = selectedSeason ?? latestSeason;
  const activeMembers = members.data?.filter((member) => member.removedAt === null) ?? [];
  const corrections = useQuery(correctionsQuery(id, season));

  const refreshMembers = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminMembersQuery(id).queryKey }),
      queryClient.invalidateQueries({ queryKey: leagueQuery(id).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['leagues'] }),
    ]);
  };

  const reportSuccess = async (message: string): Promise<void> => {
    await refreshMembers();
    toast.show(message, 'success');
  };

  const reportError = (error: unknown): void => {
    toast.show(errorMessage(error), 'error');
  };

  const rename = useMutation({
    mutationFn: () => {
      if (renameTarget === null) throw new Error('no member selected');
      return renameMember(id, renameTarget.id, renameValue.trim());
    },
    onSuccess: () => {
      setRenameTarget(null);
      void reportSuccess('Roster name updated');
    },
    onError: reportError,
  });

  const remove = useMutation({
    mutationFn: () => {
      if (action?.kind !== 'remove') throw new Error('no member selected');
      return removeMember(id, action.member.id);
    },
    onSuccess: () => {
      setAction(null);
      void reportSuccess('Member removed; their roster history was kept');
    },
    onError: reportError,
  });

  const restore = useMutation({
    mutationFn: (memberId: number) => restoreMember(id, memberId),
    onSuccess: () => {
      void reportSuccess('Roster slot restored');
    },
    onError: reportError,
  });

  const transfer = useMutation({
    mutationFn: () => {
      if (action?.kind !== 'transfer') throw new Error('no member selected');
      return transferOwnership(id, action.member.id);
    },
    onSuccess: () => {
      setAction(null);
      void reportSuccess('Commissionership transferred');
    },
    onError: reportError,
  });

  if (members.isPending || league.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (members.isError || league.isError) {
    return <Alert severity="error">{errorMessage(members.error ?? league.error)}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <AddModeratorIcon color="primary" />
        <Box>
          <Typography variant="h2">Commissioner tools</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage the roster and correct a pick without changing the player’s history.
          </Typography>
        </Box>
      </Stack>

      <CommissionerSettings league={league.data} />

      <CommissionerRoster
        members={members.data}
        onRename={(member) => {
          setRenameTarget(member);
          setRenameValue(member.displayName);
        }}
        onRemove={(member) => {
          setAction({ kind: 'remove', member });
        }}
        onRestore={(member) => {
          restore.mutate(member.id);
        }}
        onTransfer={(member) => {
          setAction({ kind: 'transfer', member });
        }}
        busy={remove.isPending || restore.isPending || transfer.isPending}
      />

      {teams.isError && <Alert severity="error">{errorMessage(teams.error)}</Alert>}
      <CommissionerCorrection
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
            queryClient.invalidateQueries({ queryKey: ['board', id] }),
            queryClient.invalidateQueries({ queryKey: ['standings', id] }),
            queryClient.invalidateQueries({ queryKey: ['history', id] }),
          ]);
          toast.show('Pick corrected and recorded in the audit log', 'success');
        }}
      />

      <RenameMemberDialog
        target={renameTarget}
        value={renameValue}
        busy={rename.isPending}
        onChange={setRenameValue}
        onClose={() => {
          setRenameTarget(null);
        }}
        onSubmit={() => {
          rename.mutate();
        }}
      />

      <MemberActionDialog
        action={action}
        busy={remove.isPending || transfer.isPending}
        onClose={() => {
          setAction(null);
        }}
        onConfirm={() => {
          if (action?.kind === 'remove') remove.mutate();
          else if (action?.kind === 'transfer') transfer.mutate();
        }}
      />
    </Stack>
  );
}
