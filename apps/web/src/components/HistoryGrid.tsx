import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { SeasonHistory } from '@gridiron/contracts';

export interface HistoryGridProps {
  readonly weeks: SeasonHistory['weeks'];
  readonly rows: SeasonHistory['rows'];
}

const RANK_WIDTH = 40;

/**
 * The name and the season total stay put while the weeks scroll between them.
 *
 * On a phone the grid is far wider than the screen, and without this, scrolling to
 * week 12 loses both the person the row belongs to and what it added up to.
 *
 * Body cells inherit their background from the row rather than naming one, so the
 * pinned columns keep following the row's own state — the caller's highlighted row,
 * and whatever is hovered — instead of punching two opaque stripes through it.
 */
const pinned = {
  position: 'sticky',
  bgcolor: 'inherit',
  zIndex: 2,
} as const;

/** The header's own background is `background.default`, which these have to match. */
const pinnedHeader = {
  position: 'sticky',
  bgcolor: 'background.default',
  zIndex: 4,
} as const;

/**
 * A whole season at once: every member, every week.
 *
 * The API sends totals only — `points[0]` is week 1 — so this renders about 1,300
 * integers for a 72-member league and still never sees another member's picks.
 */
export function HistoryGrid({ weeks, rows }: HistoryGridProps) {
  if (rows.length === 0) {
    return <Typography color="text.secondary">Nobody has joined this league yet.</Typography>;
  }

  return (
    <TableContainer sx={{ maxHeight: '70dvh' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...pinnedHeader, left: 0, width: RANK_WIDTH }}>#</TableCell>
            <TableCell sx={{ ...pinnedHeader, left: RANK_WIDTH }}>Player</TableCell>
            {weeks.map((week) => (
              <TableCell key={week.week} align="right" sx={{ px: 1 }}>
                <Typography
                  variant="caption"
                  color={week.settled ? 'text.primary' : 'text.disabled'}
                >
                  {week.week}
                </Typography>
              </TableCell>
            ))}
            <TableCell align="right" sx={{ ...pinnedHeader, right: 0, fontWeight: 700 }}>
              Total
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.memberId}
              hover
              sx={{ bgcolor: row.isSelf ? 'action.selected' : 'background.paper' }}
            >
              <TableCell sx={{ ...pinned, left: 0 }}>{row.rank}</TableCell>
              <TableCell sx={{ ...pinned, left: RANK_WIDTH, maxWidth: 150 }}>
                <Typography variant="body2" fontWeight={row.isSelf ? 700 : 400} noWrap>
                  {row.displayName}
                </Typography>
              </TableCell>
              {weeks.map((week, index) => {
                const points = row.points[index] ?? 0;
                // An unplayed week and a week they scored nothing are both zero. Only
                // the week's own state tells them apart, so a blank means "not yet".
                const blank = !week.settled && points === 0;
                return (
                  <TableCell
                    key={week.week}
                    align="right"
                    sx={{ px: 1, color: blank ? 'text.disabled' : undefined }}
                  >
                    {blank ? '—' : points}
                  </TableCell>
                );
              })}
              <TableCell align="right" sx={{ ...pinned, right: 0 }}>
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
