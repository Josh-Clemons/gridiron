import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { forgotPassword } from '../api/queries';
import { AuthLayout } from '../components/AuthLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const request = useMutation({ mutationFn: () => forgotPassword(email) });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link."
      error={request.error}
      footer={
        <Typography variant="body2" color="text.secondary">
          <Link to="/login">Back to sign in</Link>
        </Typography>
      }
    >
      {request.isSuccess ? (
        // The same message whether or not the address has an account — the API refuses
        // to confirm which addresses are registered, and saying more here would leak
        // exactly what it withheld.
        <Alert severity="success">
          If that address has an account, a reset link is on its way. The link expires in an hour.
        </Alert>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            request.mutate();
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
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              loading={request.isPending}
              fullWidth
            >
              Send reset link
            </Button>
          </Stack>
        </form>
      )}
    </AuthLayout>
  );
}
