import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { isApiError } from '../api/client';

/**
 * The signed-out shell: one card, one job.
 *
 * Sign-in happens once a season for most players, usually on a phone, so it gets a
 * short form and nothing else on the page.
 */
export function AuthLayout({
  title,
  subtitle,
  error,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  error?: unknown;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Container maxWidth="xs" sx={{ py: { xs: 4, sm: 8 } }}>
      <Stack spacing={3}>
        <Box textAlign="center">
          <Typography variant="h1" color="primary.main">
            Gridiron
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Win 5 &middot; Place 3 &middot; Show 1
          </Typography>
        </Box>

        <Paper elevation={0} variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="h2">{title}</Typography>
              {subtitle !== undefined && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {subtitle}
                </Typography>
              )}
            </Box>

            {error !== undefined && error !== null && (
              <Alert severity="error">{errorMessage(error)}</Alert>
            )}

            {children}
          </Stack>
        </Paper>

        {footer !== undefined && <Box textAlign="center">{footer}</Box>}
      </Stack>
    </Container>
  );
}

/**
 * The API's own wording, whenever there is any.
 *
 * Login failures say "invalid email or password" and nothing more specific on purpose —
 * the server refuses to reveal which half was wrong, and the client must not undo that
 * by guessing.
 */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return 'something went wrong — try again';
}

/** Field-level messages from a `bad_request`, keyed the way the API sends them. */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  return (isApiError(error) ? error.fields : undefined) ?? {};
}
