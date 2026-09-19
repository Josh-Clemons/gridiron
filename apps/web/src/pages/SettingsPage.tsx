import { MIN_PASSWORD_LENGTH, type User } from '@gridiron/contracts';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { changePassword, sessionQuery, updateProfile } from '../api/queries';
import { errorMessage, fieldErrors } from '../components/AuthLayout';
import { useToast } from '../components/Toast';

/**
 * The signed-in player's own account.
 *
 * Two separate forms because they are two separate guarantees: changing the display
 * name and email is a normal write, while changing a password must prove the current
 * one. Keeping them apart also means a wrong password on one never blanks the other.
 */
export function SettingsPage({ user }: { user: User }) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
      <Stack spacing={3}>
        <Typography variant="h2">Settings</Typography>
        <ProfileForm user={user} />
        <PasswordForm />
      </Stack>
    </Container>
  );
}

function ProfileForm({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);

  const save = useMutation({
    mutationFn: () => updateProfile({ displayName, email }),
    onSuccess: (updated) => {
      // The session cache is the source of the signed-in user; every page reads it.
      queryClient.setQueryData(sessionQuery().queryKey, updated);
      toast.show('profile saved', 'success');
    },
  });

  const fields = fieldErrors(save.error);
  // A non-field failure (an already-registered email, most likely) has no home on a
  // single input, so it gets an alert instead of a helper line.
  const general = !save.isError || Object.keys(fields).length > 0 ? undefined : save.error;

  return (
    <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
      <Stack spacing={2}>
        <div>
          <Typography variant="h3">Profile</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            This name is the default roster label for leagues you join. A league&apos;s own label is
            the commissioner&apos;s, and is not changed here.
          </Typography>
        </div>

        {general !== undefined && <Alert severity="error">{errorMessage(general)}</Alert>}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
          noValidate
        >
          <Stack spacing={2}>
            <TextField
              label="Display name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
              autoComplete="name"
              required
              fullWidth
              error={fields.displayName !== undefined}
              helperText={fields.displayName ?? ''}
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              autoComplete="email"
              required
              fullWidth
              error={fields.email !== undefined}
              helperText={fields.email ?? ''}
            />
            <Button type="submit" variant="contained" loading={save.isPending} fullWidth>
              Save profile
            </Button>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const save = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      toast.show('password changed', 'success');
    },
  });

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;

  return (
    <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
      <Stack spacing={2}>
        <div>
          <Typography variant="h3">Password</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Signing in everywhere else will be signed out — only this session stays.
          </Typography>
        </div>

        {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
          noValidate
        >
          <Stack spacing={2}>
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
              }}
              autoComplete="current-password"
              required
              fullWidth
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
              }}
              autoComplete="new-password"
              required
              fullWidth
              error={tooShort}
              helperText={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
            />
            <Button
              type="submit"
              variant="contained"
              loading={save.isPending}
              disabled={tooShort || currentPassword.length === 0}
              fullWidth
            >
              Change password
            </Button>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
