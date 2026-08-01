import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Champions, Pool } from '@gridiron/contracts';

export interface ChampionsBoardProps {
  readonly pools: Champions['pools'];
}

const POOL_LABEL: Record<Pool, string> = {
  regular: 'Regular season',
  playoff: 'Playoffs',
};

/**
 * The honours board, back to 2007.
 *
 * A year with no champion is still a row: the playoff pool played no game in 2018, and
 * a list that quietly jumped from 2019 to 2017 would look like a bug in the app rather
 * than a year that happened.
 */
export function ChampionsBoard({ pools }: ChampionsBoardProps) {
  if (pools.length === 0) {
    return (
      <Typography color="text.secondary">
        No champions have been imported yet. They come from the commissioner’s workbook.
      </Typography>
    );
  }

  return (
    <Stack spacing={3}>
      {pools.map((pool) => (
        <Stack key={pool.pool} spacing={1}>
          <Typography variant="h2">{POOL_LABEL[pool.pool]}</Typography>
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell width={72}>Year</TableCell>
                    <TableCell>Champion</TableCell>
                    <TableCell align="right" width={90}>
                      Points
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pool.years.map((entry) => (
                    <TableRow key={entry.year} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight={700}>
                          {entry.year}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {entry.champions.length === 0 ? (
                          <Typography variant="body2" color="text.disabled">
                            No champion recorded
                          </Typography>
                        ) : (
                          // Two names means the year tied — 2022 ended with Kevin
                          // Fournier and Meaghan Olender both on 146.
                          entry.champions.map((champion) => (
                            <Typography key={champion.displayName} variant="body2">
                              {champion.displayName}
                            </Typography>
                          ))
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {entry.champions.map((champion) => (
                          <Typography
                            key={champion.displayName}
                            variant="body2"
                            color="text.secondary"
                          >
                            {champion.totalPoints ?? '—'}
                          </Typography>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Stack>
      ))}
    </Stack>
  );
}
