import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import type { AdminMember } from '@gridiron/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { removeMember, renameMember, restoreMember, transferOwnership } from '../api/mutations';
import { adminMembersQuery, leagueQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import {
  CommissionerRoster,
  MemberActionDialog,
  RenameMemberDialog,
  type MemberAction,
} from '../components/CommissionerRoster';
import { useToast } from '../components/Toast';

/** Roster management on its own page: rename, remove/restore, transfer commissionership. */
export function CommissionerRosterPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const id = Number(leagueId);
  const members = useQuery(adminMembersQuery(id));
  const toast = useToast();
  const queryClient = useQueryClient();
  const [renameTarget, setRenameTarget] = useState<AdminMember | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [action, setAction] = useState<{ kind: MemberAction; member: AdminMember } | null>(null);

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
    <Stack spacing={2}>
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
