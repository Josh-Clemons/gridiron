import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import RestoreIcon from '@mui/icons-material/Restore';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AdminMember } from '@gridiron/contracts';

export type MemberAction = 'remove' | 'transfer';

export function CommissionerRoster({
  members,
  onRename,
  onRemove,
  onRestore,
  onTransfer,
  busy,
}: {
  readonly members: readonly AdminMember[];
  readonly onRename: (member: AdminMember) => void;
  readonly onRemove: (member: AdminMember) => void;
  readonly onRestore: (member: AdminMember) => void;
  readonly onTransfer: (member: AdminMember) => void;
  readonly busy: boolean;
}) {
  return (
    <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" mb={1.5}>
        Roster ({members.length})
      </Typography>
      <Stack divider={<Divider />}>
        {members.map((member) => (
          <Stack
            key={member.id}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            py={1.25}
          >
            <Box flexGrow={1} minWidth={0}>
              <Typography fontWeight={600} noWrap>
                {member.displayName}
              </Typography>
              <Stack direction="row" spacing={0.75} mt={0.5} flexWrap="wrap" useFlexGap>
                {member.role === 'owner' && <Chip label="Commissioner" size="small" />}
                <Chip
                  label={member.claimed ? 'Claimed' : 'Unclaimed'}
                  size="small"
                  variant="outlined"
                />
                {member.removedAt !== null && <Chip label="Removed" size="small" color="warning" />}
                {member.isSelf && <Chip label="You" size="small" color="secondary" />}
              </Stack>
            </Box>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                startIcon={<EditIcon />}
                onClick={() => {
                  onRename(member);
                }}
                disabled={busy}
              >
                Rename
              </Button>
              {member.removedAt === null ? (
                !member.isSelf &&
                member.role !== 'owner' && (
                  <>
                    {member.claimed && (
                      <Button
                        size="small"
                        startIcon={<SwapHorizIcon />}
                        onClick={() => {
                          onTransfer(member);
                        }}
                        disabled={busy}
                      >
                        Transfer
                      </Button>
                    )}
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineIcon />}
                      onClick={() => {
                        onRemove(member);
                      }}
                      disabled={busy}
                    >
                      Remove
                    </Button>
                  </>
                )
              ) : (
                <Button
                  size="small"
                  startIcon={<RestoreIcon />}
                  onClick={() => {
                    onRestore(member);
                  }}
                  disabled={busy}
                >
                  Restore
                </Button>
              )}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

export function RenameMemberDialog({
  target,
  value,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  readonly target: AdminMember | null;
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  return (
    <Dialog open={target !== null} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <DialogTitle>Rename roster slot</DialogTitle>
        <DialogContent>
          <TextField
            label="Display name"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            autoFocus
            required
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" loading={busy} disabled={value.trim() === ''}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function MemberActionDialog({
  action,
  busy,
  onClose,
  onConfirm,
}: {
  readonly action: { kind: MemberAction; member: AdminMember } | null;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  const transfer = action?.kind === 'transfer';
  return (
    <Dialog open={action !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{transfer ? 'Transfer commissionership?' : 'Remove this member?'}</DialogTitle>
      <DialogContent>
        <Typography>
          {transfer
            ? `${action?.member.displayName ?? 'This member'} will become the commissioner, and you will become a regular member.`
            : `${action?.member.displayName ?? 'This member'} will lose access, but their roster slot and picks will be preserved.`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color={transfer ? 'primary' : 'error'}
          onClick={onConfirm}
          loading={busy}
        >
          {transfer ? 'Transfer' : 'Remove'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
