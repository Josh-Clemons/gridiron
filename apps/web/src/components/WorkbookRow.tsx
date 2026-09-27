import DownloadIcon from '@mui/icons-material/Download';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Workbook } from '@gridiron/contracts';
import { WorkbookReport } from './WorkbookReport';

/**
 * One uploaded workbook: its name, status, and actions. The validation report rides
 * on its own row underneath — before, only the newest upload's findings were shown,
 * while every older row kept an Apply button, so an older workbook could be applied
 * by someone who never saw what its validation had found.
 */
export function WorkbookRow({
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

      <Collapse in={reportOpen} timeout="auto" unmountOnExit>
        <Box sx={{ pt: 1 }}>
          <WorkbookReport report={workbook.report} title="Validation report" />
        </Box>
      </Collapse>
    </Stack>
  );
}
