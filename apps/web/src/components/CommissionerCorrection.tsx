import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AdminMember, Correction } from '@gridiron/contracts';
import { SLOT_LABELS, type Slot } from '@gridiron/rules';
import { useState } from 'react';
import { errorMessage } from './AuthLayout';

const SLOTS: readonly Slot[] = ['win', 'place', 'show'];

export function CommissionerCorrection({
  members,
  teams,
  seasons,
  season,
  corrections,
  correctionsLoading,
  correctionsError,
  onSeasonChange,
  onCorrect,
}: {
  readonly members: readonly AdminMember[];
  readonly teams: readonly { code: string; name: string }[];
  readonly seasons: readonly { year: number; weekCount: number }[];
  readonly season: number | undefined;
  readonly corrections: readonly Correction[];
  readonly correctionsLoading: boolean;
  readonly correctionsError: unknown;
  readonly onSeasonChange: (season: number) => void;
  readonly onCorrect: (
    memberId: number,
    week: number,
    slot: Slot,
    teamId: string | null,
    reason: string,
  ) => Promise<void>;
}) {
  const [memberId, setMemberId] = useState<number | ''>('');
  const [week, setWeek] = useState(1);
  const [slot, setSlot] = useState<Slot>('win');
  const [teamId, setTeamId] = useState('');
  const [clear, setClear] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const weekCount = seasons.find((entry) => entry.year === season)?.weekCount ?? 18;
  const targetId = memberId === '' ? members[0]?.id : memberId;

  const submit = async (event: { preventDefault: () => void }): Promise<void> => {
    event.preventDefault();
    if (targetId === undefined || reason.trim().length < 3) return;
    if (!clear && teamId === '') return;
    setSubmitting(true);
    try {
      await onCorrect(
        targetId,
        Math.min(week, weekCount),
        slot,
        clear ? null : teamId,
        reason.trim(),
      );
      setReason('');
    } catch {
      // The parent reports the API error; keep the form values so the owner can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" mb={0.5}>
          Correct a pick
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Corrections bypass kickoff locks but still use every other pick rule. Each change is
          logged.
        </Typography>
        <Box
          component="form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                select
                label="Season"
                value={season ?? ''}
                onChange={(event) => {
                  onSeasonChange(Number(event.target.value));
                }}
                fullWidth
                disabled={seasons.length === 0}
              >
                {seasons.map((entry) => (
                  <MenuItem key={entry.year} value={entry.year}>
                    {entry.year}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Member"
                value={targetId ?? ''}
                onChange={(event) => {
                  setMemberId(Number(event.target.value));
                }}
                fullWidth
                disabled={members.length === 0}
              >
                {members.map((member) => (
                  <MenuItem key={member.id} value={member.id}>
                    {member.displayName}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                select
                label="Week"
                value={Math.min(week, weekCount)}
                onChange={(event) => {
                  setWeek(Number(event.target.value));
                }}
                fullWidth
              >
                {Array.from({ length: weekCount }, (_, index) => index + 1).map((value) => (
                  <MenuItem key={value} value={value}>
                    Week {value}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Slot"
                value={slot}
                onChange={(event) => {
                  const next = SLOTS.find((candidate) => candidate === event.target.value);
                  if (next !== undefined) setSlot(next);
                }}
                fullWidth
              >
                {SLOTS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {SLOT_LABELS[value]}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              select
              label="Team"
              value={clear ? '' : teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setClear(false);
              }}
              disabled={clear || teams.length === 0}
              fullWidth
            >
              {teams
                .toSorted((a, b) => a.code.localeCompare(b.code))
                .map((team) => (
                  <MenuItem key={team.code} value={team.code}>
                    {team.code} · {team.name}
                  </MenuItem>
                ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={clear}
                  onChange={(event) => {
                    setClear(event.target.checked);
                  }}
                />
              }
              label="Clear the slot instead"
            />
            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
              helperText="Required for the audit trail."
            />
            <Button
              type="submit"
              variant="contained"
              loading={submitting}
              disabled={
                targetId === undefined || reason.trim().length < 3 || (!clear && teamId === '')
              }
              fullWidth
            >
              Save correction
            </Button>
          </Stack>
        </Box>
      </Card>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" mb={1.5}>
          Correction history
        </Typography>
        <CorrectionHistory
          corrections={corrections}
          loading={correctionsLoading}
          error={correctionsError}
        />
      </Paper>
    </Stack>
  );
}

function CorrectionHistory({
  corrections,
  loading,
  error,
}: {
  readonly corrections: readonly Correction[];
  readonly loading: boolean;
  readonly error: unknown;
}) {
  if (error !== undefined) return <Alert severity="error">{errorMessage(error)}</Alert>;
  if (loading) return <CircularProgress size={24} />;
  if (corrections.length === 0) {
    return <Typography color="text.secondary">No corrections recorded for this season.</Typography>;
  }
  return (
    <Stack spacing={1.25} divider={<Divider />}>
      {corrections.map((correction) => (
        <CorrectionRow key={correction.id} correction={correction} />
      ))}
    </Stack>
  );
}

function CorrectionRow({ correction }: { correction: Correction }) {
  return (
    <Box>
      <Typography variant="body2" fontWeight={600}>
        {correction.targetName} · Week {correction.week} · {SLOT_LABELS[correction.slot]}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {correction.fromTeamId ?? 'Empty'} → {correction.toTeamId ?? 'Cleared'} · by{' '}
        {correction.actorName}
      </Typography>
      <Typography variant="body2">{correction.reason}</Typography>
      <Typography variant="caption" color="text.secondary">
        {new Date(correction.createdAt).toLocaleString()}
      </Typography>
    </Box>
  );
}
