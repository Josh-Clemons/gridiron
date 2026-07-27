import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { joinLeague, joinPreviewQuery, leaguesQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';

const NEW_MEMBER = 'new';

/**
 * What an invite code shows you before you commit.
 *
 * The claim list is the whole spreadsheet migration in one screen: the importer has
 * already loaded 19 years of picks under placeholder names, and claiming one hands a
 * player their own history instead of starting them at zero. It shows display names
 * and pick counts only — never an email, and nothing about members who are already
 * claimed.
 */
export function JoinPage() {
  const { code = '' } = useSearch({ from: '/_authed/join' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery(joinPreviewQuery(code));
  const [claim, setClaim] = useState<string>(NEW_MEMBER);
  const [displayName, setDisplayName] = useState('');

  const join = useMutation({
    mutationFn: () =>
      joinLeague({
        inviteCode: code,
        ...(claim === NEW_MEMBER ? {} : { claimMemberId: Number(claim) }),
        ...(claim === NEW_MEMBER && displayName.trim() !== ''
          ? { displayName: displayName.trim() }
          : {}),
      }),
    onSuccess: async (league) => {
      await queryClient.invalidateQueries({ queryKey: leaguesQuery().queryKey });
      await navigate({ to: '/leagues/$leagueId', params: { leagueId: String(league.id) } });
    },
  });

  if (code.length !== 8) {
    return (
      <Alert severity="warning">
        That isn't a complete invite code. <Link to="/leagues">Try again</Link>.
      </Alert>
    );
  }

  if (preview.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (preview.isError) {
    return (
      <Alert severity="error">
        {errorMessage(preview.error)} — <Link to="/leagues">back to your leagues</Link>.
      </Alert>
    );
  }

  const { league, unclaimedMembers, alreadyMember } = preview.data;

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1">{league.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {league.memberCount} {league.memberCount === 1 ? 'player' : 'players'}
        </Typography>
      </Box>

      {alreadyMember ? (
        <Alert severity="info">
          You're already in this league.{' '}
          <Link to="/leagues/$leagueId" params={{ leagueId: String(league.id) }}>
            Open it
          </Link>
          .
        </Alert>
      ) : (
        <>
          {join.isError && <Alert severity="error">{errorMessage(join.error)}</Alert>}

          <Card variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h3" gutterBottom>
              Who are you?
            </Typography>
            <RadioGroup
              value={claim}
              onChange={(event) => {
                setClaim(event.target.value);
              }}
            >
              <FormControlLabel
                value={NEW_MEMBER}
                control={<Radio />}
                label="I'm new to this league"
              />
              {unclaimedMembers.map((member) => (
                <FormControlLabel
                  key={member.id}
                  value={String(member.id)}
                  control={<Radio />}
                  label={
                    <span>
                      {member.displayName}
                      <Typography component="span" variant="body2" color="text.secondary">
                        {' '}
                        — {member.pickCount} picks already recorded
                      </Typography>
                    </span>
                  }
                />
              ))}
            </RadioGroup>

            {claim === NEW_MEMBER && (
              <TextField
                label="Name in this league"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
                size="small"
                fullWidth
                sx={{ mt: 2 }}
                helperText="Leave blank to use your account name."
              />
            )}
          </Card>

          <Button
            variant="contained"
            size="large"
            onClick={() => {
              join.mutate();
            }}
            loading={join.isPending}
          >
            {claim === NEW_MEMBER ? 'Join league' : 'Claim and join'}
          </Button>
        </>
      )}
    </Stack>
  );
}
