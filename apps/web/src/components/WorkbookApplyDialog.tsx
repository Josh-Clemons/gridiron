import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Workbook } from '@gridiron/contracts';

/**
 * The one gate in front of `--apply`.
 *
 * Applying imports picks for real, and it is the only action in the app that writes
 * other people's data wholesale. The dialog restates what validation found — the
 * importable count, and every category that will *not* import — so the confirmation
 * is an informed one rather than a reflex tap on "Apply".
 */
export function WorkbookApplyDialog({
  workbook,
  applying,
  onCancel,
  onConfirm,
}: {
  readonly workbook: Workbook;
  readonly applying: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const report = workbook.report;
  const findings =
    report === null
      ? []
      : [
          ...(report.rejections.length > 0
            ? [`${String(report.rejections.length)} rejected (score 0)`]
            : []),
          ...(report.conflicts.length > 0
            ? [`${String(report.conflicts.length)} conflict(s) (skipped)`]
            : []),
          ...(report.scoring.length > 0
            ? [`${String(report.scoring.length)} scoring disagreement(s)`]
            : []),
          ...(report.removals.length > 0 ? [`${String(report.removals.length)} removal(s)`] : []),
        ];

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Apply {workbook.originalName}?</DialogTitle>
      <DialogContent>
        {report === null ? (
          <Alert severity="error">
            This workbook has no validation report — apply it only after re-uploading it.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            <Typography>
              {String(report.importable)} picks from {String(report.playerCount)} players would be
              imported now.
            </Typography>
            {findings.length === 0 ? (
              <Alert severity="success">Clean — everything in the workbook would import.</Alert>
            ) : (
              <Alert severity="warning">
                <Typography variant="body2" fontWeight={600}>
                  This report has findings:
                </Typography>
                {findings.map((line) => (
                  <Typography key={line} variant="body2">
                    {line}
                  </Typography>
                ))}
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Those picks are not imported. Expand the workbook's report to see each one.
                </Typography>
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              The import itself is final — picks it writes can still be corrected one by one
              afterwards, with the audit log.
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          loading={applying}
          disabled={report === null}
        >
          Apply workbook
        </Button>
      </DialogActions>
    </Dialog>
  );
}
