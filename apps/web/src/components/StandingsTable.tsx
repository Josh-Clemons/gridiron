import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { LeaguePick, StandingRow } from '@gridiron/contracts';
import { useMemo, useState } from 'react';
import { PickCells } from './PickCells';

export interface StandingsTableProps {
  /**
   * Rows may carry each member's locked picks for the week. The standings endpoint
   * attaches them; the board's standings do not — its rows are integers-only and
   * the pick page's payload stays small. A row without `picks` never expands.
   */
  readonly rows: readonly (StandingRow & { readonly picks?: readonly LeaguePick[] })[];
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
 * Every row's totals are integers the server computed — the only picks that ever
 * travel are locked ones, riding on the standings rows as the `picks` field, and
 * they appear only when a row is expanded. One member open at a time, accordion
 * style, so "what did Mark take?" is a tap on his row.
 */
export function StandingsTable({ rows, week, compact = false }: StandingsTableProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const visible = useMemo(() => {
    if (!compact) return rows;
    const leaders = rows.slice(0, COMPACT_ROWS);
    const self = rows.find((row) => row.isSelf);
    if (self === undefined || leaders.includes(self)) return leaders;
    return [...leaders, self];
  }, [rows, compact]);

  const expandable = rows.some((row) => row.picks !== undefined);

  if (rows.length === 0) {
    return <Typography color="text.secondary">Nobody has joined this league yet.</Typography>;
  }

  return (
    <TableContainer>
      <Table size="small" stickyHeader={!compact}>
        <TableHead>
          <TableRow>
            {expandable && <TableCell width={44} />}
            <TableCell width={44}>#</TableCell>
            <TableCell>Player</TableCell>
            <TableCell align="right">Wk {week}</TableCell>
            <TableCell align="right">Season</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.flatMap((row, index) => {
            const isOpen = expanded === row.memberId;
            const rowCells = (
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
                {expandable && (
                  <TableCell padding="checkbox">
                    {row.picks === undefined ? null : (
                      <IconButton
                        size="small"
                        aria-label={`${isOpen ? 'Hide' : 'Show'} ${row.displayName}'s picks`}
                        aria-expanded={isOpen}
                        onClick={() => {
                          setExpanded(isOpen ? null : row.memberId);
                        }}
                      >
                        {isOpen ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                      </IconButton>
                    )}
                  </TableCell>
                )}
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
            );

            if (row.picks === undefined || !expandable) return [rowCells];

            return [
              rowCells,
              <TableRow key={`${row.memberId}-picks`} sx={{ '& td': { py: 0, borderBottom: 0 } }}>
                <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={5}>
                  <Collapse in={isOpen} timeout="auto" unmountOnExit>
                    <Box sx={{ py: 1 }}>
                      <PickCells picks={row.picks} />
                    </Box>
                  </Collapse>
                </TableCell>
              </TableRow>,
            ];
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
