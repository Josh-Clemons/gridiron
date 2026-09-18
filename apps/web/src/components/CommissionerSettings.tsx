import ArchiveIcon from '@mui/icons-material/Archive';
import RefreshIcon from '@mui/icons-material/Refresh';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { League } from '@gridiron/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { archiveLeague, regenerateInvite, renameLeague, unarchiveLeague } from '../api/mutations';
import { leagueQuery } from '../api/queries';
import { errorMessage } from './AuthLayout';
import { useToast } from './Toast';

/** League-level settings: rename, re-invite, and archive/roll-forward. */
export function CommissionerSettings({ league }: { league: League }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(league.name);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    setName(league.name);
  }, [league.name]);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: leagueQuery(league.id).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['leagues'] }),
    ]);
  };

  const reportError = (error: unknown): void => {
    toast.show(errorMessage(error), 'error');
  };

  const rename = useMutation({
    mutationFn: () => renameLeague(league.id, name.trim()),
    onSuccess: async () => {
      await refresh();
      toast.show('League renamed', 'success');
    },
    onError: reportError,
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateInvite(league.id),
    onSuccess: async () => {
      await refresh();
      toast.show('Invite code regenerated — the old one no longer works', 'success');
    },
    onError: reportError,
  });

  const toggleArchive = useMutation({
    mutationFn: () =>
      league.archivedAt === null ? archiveLeague(league.id) : unarchiveLeague(league.id),
    onSuccess: async () => {
      setConfirmArchive(false);
      await refresh();
      toast.show(
        league.archivedAt === null ? 'League archived — picks are frozen' : 'League unarchived',
        'success',
      );
    },
    onError: reportError,
  });

  const archived = league.archivedAt !== null;

  return (
    <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" mb={1.5}>
        League settings
      </Typography>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
          <TextField
            label="League name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <Button
            variant="outlined"
            onClick={() => {
              rename.mutate();
            }}
            loading={rename.isPending}
            disabled={name.trim() === '' || name.trim() === league.name}
          >
            Save
          </Button>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <Box flexGrow={1}>
            <Typography variant="caption" color="text.secondary" display="block">
              Invite code
            </Typography>
            <Chip
              label={league.inviteCode}
              variant="outlined"
              sx={{ fontFamily: 'monospace', letterSpacing: '0.15em' }}
            />
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              regenerate.mutate();
            }}
            loading={regenerate.isPending}
          >
            Regenerate
          </Button>
        </Stack>

        <Box>
          <Button
            variant="outlined"
            color={archived ? 'success' : 'warning'}
            startIcon={archived ? <UnarchiveIcon /> : <ArchiveIcon />}
            onClick={() => {
              setConfirmArchive(true);
            }}
          >
            {archived ? 'Unarchive league' : 'Archive league'}
          </Button>
        </Box>
      </Stack>

      <Dialog
        open={confirmArchive}
        onClose={() => {
          setConfirmArchive(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{archived ? 'Unarchive league?' : 'Archive league?'}</DialogTitle>
        <DialogContent>
          <Typography>
            {archived
              ? 'Unarchiving rolls the league into the next season — players can pick again.'
              : 'Archiving freezes picks. The league stays visible, but no picks can be made or changed.'}
          </Typography>
          {!archived && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              Do this at the end of the season, then unarchive when the next season is ready.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setConfirmArchive(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color={archived ? 'success' : 'warning'}
            onClick={() => {
              toggleArchive.mutate();
            }}
            loading={toggleArchive.isPending}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
