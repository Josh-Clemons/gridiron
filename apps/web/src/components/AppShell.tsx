import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { logout } from '../api/queries';

/**
 * The frame every signed-in page sits in.
 *
 * Deliberately thin: one bar, one container, no sidebar. The pick page is the app, and
 * on a phone it should start within a thumb's reach of the top of the screen.
 */
export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = useMutation({
    mutationFn: logout,
    // Everything cached belongs to the session that just ended, including other
    // members' names and standings. None of it survives the sign-out.
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 1 }}>
          <Typography
            variant="h3"
            component={Link}
            to="/leagues"
            sx={{ flexGrow: 1, color: 'inherit', textDecoration: 'none', letterSpacing: '0.02em' }}
          >
            Gridiron
          </Typography>
          <Button
            color="inherit"
            onClick={() => {
              signOut.mutate();
            }}
            loading={signOut.isPending}
          >
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      <Container
        component="main"
        sx={{ flexGrow: 1, py: { xs: 2, sm: 3 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Outlet />
      </Container>
    </Box>
  );
}
