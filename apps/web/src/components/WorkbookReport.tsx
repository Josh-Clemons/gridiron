import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { WorkbookReport as WorkbookReportData } from '@gridiron/contracts';
import { SLOT_LABELS } from '@gridiron/rules';

/** The importer's findings, rendered for the confirmation screen. */
export function WorkbookReport({ report }: { report: WorkbookReportData | null }) {
  if (report === null) {
    return <Alert severity="info">No validation report yet — upload a workbook first.</Alert>;
  }

  const sections: { title: string; lines: string[] }[] = [];
  if (report.rejections.length > 0) {
    sections.push({
      title: `Rejected (${report.rejections.length}) — left empty, scoring 0`,
      lines: report.rejections.map(
        (r) =>
          `${r.playerName} · week ${r.week} ${SLOT_LABELS[r.slot]} · ${r.teamToken} — ${r.reasons.join('; ')}`,
      ),
    });
  }
  if (report.conflicts.length > 0) {
    sections.push({
      title: `Conflicts (${report.conflicts.length}) — neither side imported`,
      lines: report.conflicts.map(
        (c) =>
          `${c.playerName} · week ${c.week} ${SLOT_LABELS[c.slot]} · sheet ${c.sheetTeam}, app ${c.appTeam}`,
      ),
    });
  }
  if (report.scoring.length > 0) {
    sections.push({
      title: `Scoring disagreements (${report.scoring.length})`,
      lines: report.scoring.map(
        (s) => `${s.playerName} · sheet ${s.sheet ?? 0}, computed ${s.computed}`,
      ),
    });
  }
  if (report.removals.length > 0) {
    sections.push({
      title: `Removed (${report.removals.length})`,
      lines: report.removals.map(
        (r) => `${r.playerName} · week ${r.week} ${SLOT_LABELS[r.slot]} · ${r.teamCode}`,
      ),
    });
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" mb={1}>
        Latest validation report
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1.5}>
        {report.playerCount} players · {report.picksInSheet} picks · {report.importable} importable
        {report.applied ? ' · applied' : ' · not applied'}
      </Typography>
      {sections.length === 0 ? (
        <Alert severity="success">Clean — everything in the workbook would import.</Alert>
      ) : (
        <Stack spacing={1.5}>
          {sections.map((section) => (
            <Box key={section.title}>
              <Typography variant="body2" fontWeight={600}>
                {section.title}
              </Typography>
              {section.lines.map((line) => (
                <Typography key={line} variant="body2" color="text.secondary" sx={{ pl: 1 }}>
                  {line}
                </Typography>
              ))}
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
