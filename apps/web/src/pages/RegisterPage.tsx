import { MIN_PASSWORD_LENGTH } from '@gridiron/contracts';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { register, sessionQuery } from '../api/queries';
import { AuthLayout, fieldErrors } from '../components/AuthLayout';

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const signUp = useMutation({
    mutationFn: () => register({ email, password, displayName }),
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQuery().queryKey, session.user);
      await navigate({ to: '/leagues' });
    },
  });

  const fields = fieldErrors(signUp.error);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  return (
    <AuthLayout
      title="Create an account"
      subtitle="You'll join your league with its invite code next."
      error={signUp.error}
      footer={
        <Typography variant="body2" color="text.secondary">
          Already have one? <Link to="/login">Sign in</Link>
        </Typography>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          signUp.mutate();
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
            autoFocus
            required
            fullWidth
            helperText={fields.displayName ?? 'What the rest of the league sees.'}
            error={fields.displayName !== undefined}
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
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="new-password"
            required
            fullWidth
            error={tooShort || fields.password !== undefined}
            // Length is the only rule the server enforces, so it's the only one stated
            // here. Character-class advice mostly produces `Password1!`.
            helperText={fields.password ?? `At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            loading={signUp.isPending}
            disabled={tooShort}
            fullWidth
          >
            Create account
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
