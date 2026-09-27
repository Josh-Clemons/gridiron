import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Correction } from '@gridiron/contracts';
import { SLOT_LABELS } from '@gridiron/rules';
import { errorMessage } from './AuthLayout';

/**
 * The audit trail every correction leaves behind, most recent last.
 *
 * Lives beside the form that writes it so the owner sees the log grow as they work.
 */
export function CorrectionHistory({
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
