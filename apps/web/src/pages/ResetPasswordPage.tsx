import { MIN_PASSWORD_LENGTH } from '@gridiron/contracts';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { resetPassword, sessionQuery } from '../api/queries';
import { AuthLayout } from '../components/AuthLayout';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = useSearch({ from: '/reset-password' });
  const [password, setPassword] = useState('');

  const reset = useMutation({
    mutationFn: () => resetPassword(token ?? '', password),
    // Redeeming the token already signed us in, so go straight to the app rather than
    // bouncing through a sign-in form for the password chosen a second ago.
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQuery().queryKey, session.user);
      await navigate({ to: '/leagues' });
    },
  });
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  if (token === undefined || token === '') {
    return (
      <AuthLayout title="Reset your password">
        <Alert severity="warning">
          This link is missing its token. Ask for a new one from{' '}
          <Link to="/forgot-password">the reset page</Link>.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      error={reset.error}
      footer={
        <Typography variant="body2" color="text.secondary">
          <Link to="/login">Back to sign in</Link>
        </Typography>
      }
    >
      {reset.isSuccess ? (
        <Alert severity="success">
          Your password is changed and every other session has been signed out. Taking you to your
          leagues…
        </Alert>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            reset.mutate();
          }}
          noValidate
        >
          <Stack spacing={2}>
            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              autoComplete="new-password"
              autoFocus
              required
              fullWidth
              error={tooShort}
              helperText={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              loading={reset.isPending}
              disabled={tooShort}
              fullWidth
            >
              Change password
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}
