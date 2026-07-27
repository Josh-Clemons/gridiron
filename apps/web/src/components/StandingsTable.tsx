import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { StandingRow } from '@gridiron/contracts';
import { useMemo } from 'react';

export interface StandingsTableProps {
  readonly rows: readonly StandingRow[];
  readonly week: number;
  /**
   * Show only the leaders plus the caller's own row. The pick page uses this; the
   * standings page shows everyone.
   */
  readonly compact?: boolean;
}

const COMPACT_ROWS = 5;

/**
 * The league table.
 *
 * Every row is four integers the server computed — never anyone else's picks. At 72
 * members, shipping picks to render this would be megabytes; the API aggregates and
 * this renders. That constraint is the reason `standings` exists as its own shape.
 */
export function StandingsTable({ rows, week, compact = false }: StandingsTableProps) {
  const visible = useMemo(() => {
    if (!compact) return rows;
    const leaders = rows.slice(0, COMPACT_ROWS);
    const self = rows.find((row) => row.isSelf);
    if (self === undefined || leaders.includes(self)) return leaders;
    return [...leaders, self];
  }, [rows, compact]);

  if (rows.length === 0) {
    return <Typography color="text.secondary">Nobody has joined this league yet.</Typography>;
  }

  return (
    <TableContainer>
      <Table size="small" stickyHeader={!compact}>
        <TableHead>
          <TableRow>
            <TableCell width={44}>#</TableCell>
            <TableCell>Player</TableCell>
            <TableCell align="right">Wk {week}</TableCell>
            <TableCell align="right">Season</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.map((row, index) => (
            <TableRow
              key={row.memberId}
              selected={row.isSelf}
              // A gap in the compact view means rows were skipped, not that ranks jumped.
              sx={
                compact && index > 0 && row.rank - (visible[index - 1]?.rank ?? 0) > 1
                  ? { '& td': { borderTop: '2px dotted', borderTopColor: 'divider' } }
                  : undefined
              }
            >
              <TableCell>{row.rank}</TableCell>
              <TableCell>
                <Box display="flex" alignItems="center" gap={0.75}>
                  <Typography variant="body2" fontWeight={row.isSelf ? 700 : 400} noWrap>
                    {row.displayName}
                  </Typography>
                  {!row.claimed && (
                    // A roster slot the importer created that nobody has registered
                    // against yet. Their picks and score are real; the account isn't.
                    <Chip label="Unclaimed" size="small" variant="outlined" />
                  )}
                </Box>
              </TableCell>
              <TableCell align="right">{row.weekPoints}</TableCell>
              <TableCell align="right">
                <Typography variant="body2" fontWeight={700}>
                  {row.seasonPoints}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
