import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { resetPassword } from '../api/queries';
import { AuthLayout } from '../components/AuthLayout';

const MIN_PASSWORD = 10;

export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' });
  const [password, setPassword] = useState('');

  const reset = useMutation({ mutationFn: () => resetPassword(token ?? '', password) });
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

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
          Your password is changed and every other session has been signed out.{' '}
          <Link to="/login">Sign in</Link>.
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
              helperText={`At least ${String(MIN_PASSWORD)} characters.`}
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
