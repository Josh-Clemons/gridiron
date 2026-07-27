import AddIcon from '@mui/icons-material/Add';
import GroupIcon from '@mui/icons-material/Group';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { createLeague, leaguesQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { CardActionAreaLink } from '../components/links';

export function LeaguesPage() {
  const leagues = useQuery(leaguesQuery());
  const [creating, setCreating] = useState(false);

  if (leagues.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (leagues.isError) {
    return <Alert severity="error">{errorMessage(leagues.error)}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h1">Your leagues</Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            setCreating(true);
          }}
        >
          New
        </Button>
      </Stack>

      {leagues.data.length === 0 ? (
        <Alert severity="info">
          You aren't in a league yet. Join one with an invite code, or start your own.
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          {leagues.data.map((league) => (
            <Card key={league.id} variant="outlined">
              <CardActionAreaLink
                to="/leagues/$leagueId"
                params={{ leagueId: String(league.id) }}
                sx={{ p: 2 }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Box flexGrow={1} minWidth={0}>
                    <Typography variant="h3" noWrap>
                      {league.name}
                    </Typography>
                    <Stack direction="row" spacing={0.75} alignItems="center" mt={0.5}>
                      <GroupIcon fontSize="inherit" color="disabled" />
                      <Typography variant="body2" color="text.secondary">
                        {league.memberCount} {league.memberCount === 1 ? 'player' : 'players'}
                      </Typography>
                    </Stack>
                  </Box>
                  {league.role === 'owner' && <Chip label="Commissioner" size="small" />}
                  {league.archivedAt !== null && (
                    <Chip label="Archived" size="small" color="default" variant="outlined" />
                  )}
                </Stack>
              </CardActionAreaLink>
            </Card>
          ))}
        </Stack>
      )}

      <JoinByCode />

      <CreateLeagueDialog
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
    </Stack>
  );
}

/**
 * The invite code is how all 72 of them arrive.
 *
 * It's eight characters from an alphabet with no I, O, 0 or 1, because it gets read
 * aloud and retyped from a phone. Case and stray spaces are the server's problem, not
 * the player's.
 */
function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/join', search: { code: code.trim().toUpperCase() } });
        }}
      >
        <Stack spacing={1.5}>
          <Typography variant="h3">Join a league</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Invite code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
              }}
              slotProps={{ htmlInput: { maxLength: 8, style: { letterSpacing: '0.2em' } } }}
              size="small"
              fullWidth
            />
            <Button type="submit" variant="contained" disabled={code.trim().length !== 8}>
              Look up
            </Button>
          </Stack>
        </Stack>
      </form>
    </Card>
  );
}

function CreateLeagueDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => createLeague({ name: name.trim() }),
    onSuccess: async (league) => {
      await queryClient.invalidateQueries({ queryKey: leaguesQuery().queryKey });
      onClose();
      await navigate({ to: '/leagues/$leagueId', params: { leagueId: String(league.id) } });
    },
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <DialogTitle>New league</DialogTitle>
        <DialogContent>
          <Stack spacing={2} pt={1}>
            {create.isError && <Alert severity="error">{errorMessage(create.error)}</Alert>}
            <TextField
              label="League name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              autoFocus
              required
              fullWidth
              helperText="You'll be its commissioner, and you'll get an invite code to share."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            loading={create.isPending}
            disabled={name.trim() === ''}
          >
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
