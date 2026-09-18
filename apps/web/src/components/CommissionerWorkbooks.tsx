import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
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
export function CommissionerWorkbooks({ leagueId }: { leagueId: number }) {
  const workbooks = useQuery(adminWorkbooksQuery(leagueId));
  const seasons = useQuery(seasonsQuery(leagueId));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [season, setSeason] = useState<number | ''>('');

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
    onSuccess: async () => {
      setFile(null);
      await refresh();
      toast.show('Workbook uploaded and validated', 'success');
    },
    onError: reportError,
  });

  const apply = useMutation({
    mutationFn: (workbookId: number) => applyWorkbook(leagueId, workbookId),
    onSuccess: async () => {
      await refresh();
      toast.show('Workbook applied — picks imported', 'success');
    },
    onError: reportError,
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

  const selected = workbooks.data[0];

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
                applying={apply.isPending}
                onApply={() => {
                  apply.mutate(workbook.id);
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

      {selected !== undefined && <WorkbookReport report={selected.report} />}
    </Stack>
  );
}

function WorkbookRow({
  workbook,
  applying,
  onApply,
  onDownload,
}: {
  readonly workbook: Workbook;
  readonly applying: boolean;
  readonly onApply: () => void;
  readonly onDownload: () => void;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      py={1.25}
    >
      <Box flexGrow={1} minWidth={0}>
        <Typography fontWeight={600} noWrap>
          {workbook.originalName}
        </Typography>
        <Stack direction="row" spacing={0.75} mt={0.5}>
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
  );
}
