import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { headToHeadQuery, membersQuery, seasonsQuery } from '../api/queries';
import { errorMessage } from '../components/AuthLayout';
import { SeasonNav } from '../components/SeasonNav';

/** Two members, compared week by week, with the scoreboard styled as a season. */
export function HeadToHeadPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  const search = useSearch({ from: '/_authed/leagues/$leagueId/head-to-head' });
  const navigate = useNavigate();

  const members = useQuery(membersQuery(Number(leagueId)));
  const seasons = useQuery(seasonsQuery(Number(leagueId)));

  const self = members.data?.find((member) => member.isSelf);
  const other = members.data?.find((member) => !member.isSelf);
  // The URL is the source of truth once someone picks; before that, self vs. the
  // first other member is the natural pairing.
  const a = search.a ?? self?.id;
  const b = search.b ?? other?.id;

  const headToHead = useQuery({
    ...headToHeadQuery(Number(leagueId), search.season, a ?? 0, b ?? 0),
    enabled: a !== undefined && b !== undefined && a !== b,
  });

  const navigateWith = (patch: { season?: number; a?: number; b?: number }): void => {
    void navigate({
      to: '/leagues/$leagueId/head-to-head',
      params: { leagueId },
      search: {
        ...(search.season === undefined ? {} : { season: search.season }),
        ...(a === undefined ? {} : { a }),
        ...(b === undefined ? {} : { b }),
        ...patch,
      },
    });
  };

  if (members.isPending) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (members.isError) {
    return <Alert severity="error">{errorMessage(members.error)}</Alert>;
  }

  if ((members.data?.length ?? 0) < 2) {
    return (
      <Typography color="text.secondary">
        Head-to-head needs two players — invite someone first.
      </Typography>
    );
  }

  const memberOptions = members.data ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Player one"
          value={a ?? ''}
          onChange={(event) => {
            navigateWith({ a: Number(event.target.value) });
          }}
          sx={{ minWidth: 160 }}
        >
          {memberOptions.map((member) => (
            <MenuItem key={member.id} value={member.id}>
              {member.displayName}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          vs.
        </Typography>
        <TextField
          select
          size="small"
          label="Player two"
          value={b ?? ''}
          onChange={(event) => {
            navigateWith({ b: Number(event.target.value) });
          }}
          sx={{ minWidth: 160 }}
        >
          {memberOptions.map((member) => (
            <MenuItem key={member.id} value={member.id}>
              {member.displayName}
            </MenuItem>
          ))}
        </TextField>
        <SeasonNav
          season={headToHead.data?.season.year ?? search.season ?? seasons.data?.[0]?.year ?? 0}
          seasons={seasons.data ?? []}
          onChange={(year) => {
            navigateWith({ season: year });
          }}
        />
      </Stack>

      {headToHead.isError && <Alert severity="error">{errorMessage(headToHead.error)}</Alert>}

      {headToHead.isPending && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}

      {headToHead.data !== undefined && (
        <HeadToHeadTable
          weeks={headToHead.data.weeks}
          aName={headToHead.data.a.displayName}
          aPoints={headToHead.data.a.points}
          aSeason={headToHead.data.a.seasonPoints}
          bName={headToHead.data.b.displayName}
          bPoints={headToHead.data.b.points}
          bSeason={headToHead.data.b.seasonPoints}
          record={headToHead.data.record}
        />
      )}
    </Stack>
  );
}

interface HeadToHeadTableProps {
  readonly weeks: readonly { week: number; settled: boolean }[];
  readonly aName: string;
  readonly aPoints: readonly number[];
  readonly aSeason: number;
  readonly bName: string;
  readonly bPoints: readonly number[];
  readonly bSeason: number;
  readonly record: { aWins: number; bWins: number; ties: number };
}

function HeadToHeadTable({
  weeks,
  aName,
  aPoints,
  aSeason,
  bName,
  bPoints,
  bSeason,
  record,
}: HeadToHeadTableProps) {
  return (
    <Paper variant="outlined" sx={{ maxHeight: '70dvh', overflow: 'auto' }}>
      <TableContainer>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Player</TableCell>
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
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                Total
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[aName, bName].map((name, index) => {
              const points = index === 0 ? aPoints : bPoints;
              const season = index === 0 ? aSeason : bSeason;
              const isA = index === 0;
              return (
                <TableRow key={name} hover sx={{ bgcolor: 'background.paper' }}>
                  <TableCell sx={{ maxWidth: 160 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {name}
                    </Typography>
                  </TableCell>
                  {weeks.map((week, weekIndex) => {
                    const mine = points[weekIndex] ?? 0;
                    const theirs = (isA ? bPoints : aPoints)[weekIndex] ?? 0;
                    const blank = !week.settled && mine === 0;
                    const won = week.settled && mine > theirs;
                    const lost = week.settled && mine < theirs;
                    return (
                      <TableCell
                        key={week.week}
                        align="right"
                        sx={{
                          px: 1,
                          fontWeight: won ? 700 : undefined,
                          color: blank
                            ? 'text.disabled'
                            : won
                              ? 'success.main'
                              : lost
                                ? 'text.primary'
                                : undefined,
                        }}
                      >
                        {blank ? '—' : mine}
                      </TableCell>
                    );
                  })}
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>
                      {season}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Box p={1.5}>
        <Chip
          size="small"
          label={`${aName} ${record.aWins} – ${record.bWins} ${bName}${
            record.ties === 0 ? '' : ` · ${String(record.ties)} tie${record.ties === 1 ? '' : 's'}`
          }`}
        />
      </Box>
    </Paper>
  );
}
