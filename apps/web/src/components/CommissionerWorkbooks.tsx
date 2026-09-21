import DownloadIcon from '@mui/icons-material/Download';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Workbook } from '@gridiron/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { download } from '../api/client';
import { applyWorkbook, uploadWorkbook } from '../api/mutations';
import { adminWorkbooksQuery, seasonsQuery } from '../api/queries';
import { errorMessage } from './AuthLayout';
import { useToast } from './Toast';
import { WorkbookReport } from './WorkbookReport';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Upload, validate, confirm, download and export the commissioner's workbook. */
export function CommissionerWorkbooks({ leagueId }: { readonly leagueId: number }) {
  const workbooks = useQuery(adminWorkbooksQuery(leagueId));
  const seasons = useQuery(seasonsQuery(leagueId));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [season, setSeason] = useState<number | ''>('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const latestSeason =
    seasons.data !== undefined && seasons.data.length > 0
      ? Math.max(...seasons.data.map((entry) => entry.year))
      : undefined;
  const effectiveSeason = season === '' ? (latestSeason ?? 2026) : season;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: adminWorkbooksQuery(leagueId).queryKey });
  };

  const reportError = (error: unknown): void => {
    toast.show(errorMessage(error), 'error');
  };

  const upload = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error('choose a file first');
      return uploadWorkbook(leagueId, file, effectiveSeason);
    },
    onSuccess: async (workbook) => {
      setFile(null);
      // Show what was found immediately — the report is the reason the upload exists.
      setExpandedId(workbook.id);
      await refresh();
      toast.show('Workbook uploaded and validated', 'success');
    },
    onError: reportError,
  });

  const apply = useMutation({
    mutationFn: (workbookId: number) => applyWorkbook(leagueId, workbookId),
    onSuccess: async () => {
      setConfirmId(null);
      await refresh();
      toast.show('Workbook applied — picks imported', 'success');
    },
    onError: (error) => {
      setConfirmId(null);
      reportError(error);
    },
  });

  const fetchAndSave = async (path: string): Promise<void> => {
    try {
      const result = await download(path);
      triggerDownload(result.blob, result.filename);
    } catch (error) {
      reportError(error);
    }
  };

  if (workbooks.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (workbooks.isError) {
    return <Alert severity="error">{errorMessage(workbooks.error)}</Alert>;
  }

  const confirming =
    confirmId === null ? undefined : workbooks.data.find((row) => row.id === confirmId);

  return (
    <Stack spacing={2}>
      <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" mb={0.5}>
          Upload a workbook
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Uploading runs validation only — nothing is imported until you confirm.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
          <TextField
            select
            size="small"
            label="Season"
            value={effectiveSeason}
            onChange={(event) => {
              setSeason(Number(event.target.value));
            }}
            sx={{ minWidth: 120 }}
          >
            {seasons.data?.map((entry) => (
              <MenuItem key={entry.year} value={entry.year}>
                {entry.year}
              </MenuItem>
            ))}
          </TextField>
          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
            {file === null ? 'Choose file' : file.name}
            <input
              type="file"
              hidden
              accept=".xlsx,.xls"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              upload.mutate();
            }}
            loading={upload.isPending}
            disabled={file === null}
          >
            Upload &amp; validate
          </Button>
        </Stack>
      </Card>

      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => {
            void fetchAndSave(
              `/leagues/${String(leagueId)}/admin/export?season=${String(effectiveSeason)}`,
            );
          }}
        >
          Download recreated workbook
        </Button>
      </Stack>

      <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" mb={1.5}>
          Uploads ({workbooks.data.length})
        </Typography>
        {workbooks.data.length === 0 ? (
          <Typography color="text.secondary">Nothing uploaded yet.</Typography>
        ) : (
          <Stack divider={<Divider />}>
            {workbooks.data.map((workbook) => (
              <WorkbookRow
                key={workbook.id}
                workbook={workbook}
                reportOpen={expandedId === workbook.id}
                applying={apply.isPending}
                onToggleReport={() => {
                  setExpandedId(expandedId === workbook.id ? null : workbook.id);
                }}
                onApply={() => {
                  setConfirmId(workbook.id);
                }}
                onDownload={() => {
                  void fetchAndSave(
                    `/leagues/${String(leagueId)}/admin/workbooks/${String(workbook.id)}/download`,
                  );
                }}
              />
            ))}
          </Stack>
        )}
      </Card>

      {confirming !== undefined && (
        <ApplyConfirmDialog
          workbook={confirming}
          applying={apply.isPending}
          onCancel={() => {
            setConfirmId(null);
          }}
          onConfirm={() => {
            apply.mutate(confirming.id);
          }}
        />
      )}
    </Stack>
  );
}

function WorkbookRow({
  workbook,
  reportOpen,
  applying,
  onToggleReport,
  onApply,
  onDownload,
}: {
  readonly workbook: Workbook;
  readonly reportOpen: boolean;
  readonly applying: boolean;
  readonly onToggleReport: () => void;
  readonly onApply: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <Stack py={1.25}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <Box flexGrow={1} minWidth={0}>
          <Typography fontWeight={600} noWrap>
            {workbook.originalName}
          </Typography>
          <Stack direction="row" spacing={0.75} mt={0.5} alignItems="center" flexWrap="wrap">
            <Chip label={String(workbook.season)} size="small" variant="outlined" />
            {workbook.appliedAt === null ? (
              <Chip label="Not applied" size="small" />
            ) : (
              <Chip label="Applied" size="small" color="success" />
            )}
            <Typography variant="caption" color="text.secondary">
              {new Date(workbook.uploadedAt).toLocaleString()}
            </Typography>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            endIcon={reportOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            disabled={workbook.report === null}
            aria-expanded={reportOpen}
            onClick={onToggleReport}
          >
            Report
          </Button>
          <Button size="small" startIcon={<DownloadIcon />} onClick={onDownload}>
            Download
          </Button>
          {workbook.appliedAt === null && (
            <Button
              size="small"
              variant="contained"
              onClick={onApply}
              loading={applying}
              disabled={workbook.report === null}
            >
              Apply
            </Button>
          )}
        </Stack>
      </Stack>

      {/*
        The report rides on its own row, under the workbook it belongs to. Before, only
        the newest upload's findings were shown, while every older row kept an Apply
        button — an older workbook could be applied by someone who never saw what its
        validation had found.
      */}
      <Collapse in={reportOpen} timeout="auto" unmountOnExit>
        <Box sx={{ pt: 1 }}>
          <WorkbookReport report={workbook.report} title="Validation report" />
        </Box>
      </Collapse>
    </Stack>
  );
}

/**
 * The one gate in front of `--apply`.
 *
 * Applying imports picks for real, and it is the only action in the app that writes
 * other people's data wholesale. The dialog restates what validation found — the
 * importable count, and every category that will *not* import — so the confirmation
 * is an informed one rather than a reflex tap on "Apply".
 */
function ApplyConfirmDialog({
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
