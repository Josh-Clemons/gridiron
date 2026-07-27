import LockIcon from '@mui/icons-material/Lock';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { Team } from '@gridiron/contracts';
import {
  availableTeamsFor,
  type Game,
  type Pick,
  type Slot,
  SLOT_LABELS,
  SLOT_POINTS,
  type TeamOption,
} from '@gridiron/rules';
import { useMemo } from 'react';
import { formatCountdown, formatKickoff } from '../lib/format';
import { reasonFor } from '../lib/rejections';

export interface TeamPickerDialogProps {
  readonly open: boolean;
  readonly slot: Slot;
  readonly week: number;
  readonly games: readonly Game[];
  readonly seasonPicks: readonly Pick[];
  readonly now: Date;
  readonly teams: ReadonlyMap<string, Team>;
  readonly currentTeamId: string | undefined;
  readonly onSelect: (teamId: string) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

/**
 * Choose a team for one slot.
 *
 * Every team playing this week is listed, including the ones you can't have — greyed
 * out, with the rule it breaks written underneath. That decision is the whole point of
 * the page. The old app let you select an illegal team, fired a red toast that closed
 * after one second, and silently put the field back; you could lose a minute to a rule
 * nobody had told you about.
 *
 * The legality check is `availableTeamsFor` from `@gridiron/rules` — literally the same
 * function the API runs before it writes — so what's greyed out here is exactly what
 * would be refused there.
 */
export function TeamPickerDialog(props: TeamPickerDialogProps) {
  const { open, slot, week, games, seasonPicks, now, teams, currentTeamId } = props;
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const options = useMemo(
    () => availableTeamsFor({ seasonPicks, games, week, slot, now }),
    [seasonPicks, games, week, slot, now],
  );

  const byTeam = useMemo(
    () => new Map(options.map((option) => [option.teamId, option])),
    [options],
  );

  const weekGames = useMemo(
    () =>
      games
        .filter((game) => game.week === week)
        .toSorted((a, b) => a.kickoff.getTime() - b.kickoff.getTime()),
    [games, week],
  );

  return (
    <Dialog open={open} onClose={props.onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <AppBar position="sticky" color="primary" elevation={0}>
        <Toolbar>
          <Box flexGrow={1}>
            <Typography variant="h3">
              {SLOT_LABELS[slot]} &middot; {SLOT_POINTS[slot]}{' '}
              {SLOT_POINTS[slot] === 1 ? 'pt' : 'pts'}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Week {week}
            </Typography>
          </Box>
          <IconButton color="inherit" onClick={props.onClose} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <DialogContent sx={{ px: { xs: 1, sm: 2 }, py: 2 }}>
        {weekGames.length === 0 ? (
          <Typography color="text.secondary">No games are scheduled for this week yet.</Typography>
        ) : (
          <Stack divider={<Divider flexItem />} spacing={1.5}>
            {weekGames.map((game) => (
              <GameRow
                key={game.id}
                game={game}
                now={now}
                teams={teams}
                away={byTeam.get(game.awayTeam)}
                home={byTeam.get(game.homeTeam)}
                currentTeamId={currentTeamId}
                onSelect={props.onSelect}
              />
            ))}
          </Stack>
        )}

        {currentTeamId !== undefined && (
          <Box mt={3}>
            <Button color="error" variant="outlined" fullWidth onClick={props.onClear}>
              Clear this pick
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GameRow({
  game,
  now,
  teams,
  away,
  home,
  currentTeamId,
  onSelect,
}: {
  game: Game;
  now: Date;
  teams: ReadonlyMap<string, Team>;
  away: TeamOption | undefined;
  home: TeamOption | undefined;
  currentTeamId: string | undefined;
  onSelect: (teamId: string) => void;
}) {
  const locked = now.getTime() >= game.kickoff.getTime();

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1, pb: 0.75 }}>
        {locked && <LockIcon fontSize="inherit" color="disabled" />}
        <Typography variant="caption" color="text.secondary">
          {formatKickoff(game.kickoff)}
          {!locked && ` · ${formatCountdown(game.kickoff, now)}`}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1}>
        <TeamButton
          option={away}
          teams={teams}
          selected={currentTeamId === game.awayTeam}
          onSelect={onSelect}
        />
        <TeamButton
          option={home}
          teams={teams}
          selected={currentTeamId === game.homeTeam}
          onSelect={onSelect}
        />
      </Stack>
    </Box>
  );
}

function TeamButton({
  option,
  teams,
  selected,
  onSelect,
}: {
  option: TeamOption | undefined;
  teams: ReadonlyMap<string, Team>;
  selected: boolean;
  onSelect: (teamId: string) => void;
}) {
  if (option === undefined) return <Box flex={1} />;

  const team = teams.get(option.teamId);
  // Only the first reason is shown. A pick can break several rules at once, but the
  // one that matters is the one you can act on, and a button is not a report.
  const reason = option.rejections[0] === undefined ? undefined : reasonFor(option.rejections[0]);

  return (
    <Button
      variant={selected ? 'contained' : 'outlined'}
      color={selected ? 'secondary' : 'primary'}
      disabled={!option.selectable}
      onClick={() => {
        onSelect(option.teamId);
      }}
      aria-label={`${team?.name ?? option.teamId}${option.selectable ? '' : ` — unavailable: ${reason ?? ''}`}`}
      sx={{
        flex: 1,
        flexDirection: 'column',
        alignItems: 'flex-start',
        textAlign: 'left',
        py: 1,
        px: 1.5,
        minWidth: 0,
      }}
    >
      <Typography variant="subtitle2" component="span" sx={{ fontWeight: 700 }}>
        {option.teamId}
        <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.7 }}>
          {option.isHome ? 'vs' : '@'} {option.opponent}
        </Typography>
      </Typography>
      <Typography
        component="span"
        variant="caption"
        sx={{ opacity: 0.75, whiteSpace: 'normal', lineHeight: 1.25 }}
      >
        {reason ?? team?.shortName ?? ''}
      </Typography>
    </Button>
  );
}
