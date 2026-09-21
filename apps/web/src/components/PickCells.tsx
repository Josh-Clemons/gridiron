import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RemoveIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { LeaguePick } from '@gridiron/contracts';
import { SLOTS, type Slot } from '@gridiron/rules';
import { teamLogoUrl } from '../lib/logos';

export interface PickCellsProps {
  /** A member's locked picks for the week — slots absent from the array are open. */
  readonly picks: readonly LeaguePick[];
}

/**
 * One member's three slots: logo, code, and what the pick earned.
 *
 * The slot is identified by position and tint rather than a label — three chips in
 * Win/Place/Show order is the hierarchy a glance reads, and words on every chip of
 * every row of the table is noise. An open or unfilled slot shows a dash.
 */
export function PickCells({ picks }: PickCellsProps) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ py: 0.5 }}>
      {SLOTS.map((slot) => (
        <SlotCell key={slot} slot={slot} pick={picks.find((p) => p.slot === slot)} />
      ))}
    </Stack>
  );
}

function SlotCell({ slot, pick }: { readonly slot: Slot; readonly pick: LeaguePick | undefined }) {
  if (pick === undefined) {
    // The slot is genuinely empty — either never picked or, for a game that has
    // kicked off, rejected by the importer. Either way it scores 0 and shows as —.
    return (
      <Stack
        alignItems="center"
        sx={{ px: 1.25, py: 0.75, borderRadius: 2, bgcolor: 'action.hover' }}
      >
        <RemoveIcon color="disabled" sx={{ fontSize: 20 }} />
      </Stack>
    );
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      sx={{
        px: 1.25,
        py: 0.5,
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.slot[slot].main, 0.12),
      }}
    >
      <Box
        component="img"
        src={teamLogoUrl(pick.teamId)}
        alt={pick.teamId}
        sx={{ width: 20, height: 20 }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {pick.teamId}
      </Typography>
      <OutcomeMark outcome={pick.outcome} points={pick.points} />
    </Stack>
  );
}

/** What the pick earned: a tick, a cross, or a quiet dash while the game runs. */
function OutcomeMark({ outcome, points }: { readonly outcome: string; readonly points: number }) {
  if (outcome === 'win') {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<CheckIcon />}
        label={String(points)}
        sx={{ '.MuiChip-iconSmall': { ml: 0.5 } }}
      />
    );
  }
  if (outcome === 'loss') {
    return <Chip size="small" color="default" variant="outlined" icon={<CloseIcon />} label="0" />;
  }
  return <Chip size="small" variant="outlined" icon={<RemoveIcon />} label="—" />;
}
