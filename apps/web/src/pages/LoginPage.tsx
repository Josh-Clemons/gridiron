import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { login, sessionQuery } from '../api/queries';
import { AuthLayout, fieldErrors } from '../components/AuthLayout';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/login' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signIn = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: async (session) => {
      // Seed the session cache from the response rather than making the guard refetch
      // it; the redirect below would otherwise wait on a round trip we just made.
      queryClient.setQueryData(sessionQuery().queryKey, session.user);
      await navigate({ to: search.redirect ?? '/leagues' });
    },
  });

  const fields = fieldErrors(signIn.error);

  return (
    <AuthLayout
      title="Sign in"
      error={signIn.error}
      footer={
        <Typography variant="body2" color="text.secondary">
          New here? <Link to="/register">Create an account</Link>
        </Typography>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          signIn.mutate();
        }}
        noValidate
      >
        <Stack spacing={2}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            autoComplete="email"
            autoFocus
            required
            fullWidth
            error={fields.email !== undefined}
            helperText={fields.email ?? ''}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            required
            fullWidth
            error={fields.password !== undefined}
            helperText={fields.password ?? ''}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            loading={signIn.isPending}
            fullWidth
          >
            Sign in
          </Button>
          <Typography variant="body2" textAlign="center">
            <Link to="/forgot-password">Forgot your password?</Link>
          </Typography>
        </Stack>
      </form>
    </AuthLayout>
  );
}
