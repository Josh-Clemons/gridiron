import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LockIcon from '@mui/icons-material/Lock';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { Pick as WirePick, Team } from '@gridiron/contracts';
import { type Game, type Slot, SLOT_LABELS, SLOT_POINTS } from '@gridiron/rules';
import { formatCountdown, formatKickoff } from '../lib/format';
import { teamLogoUrl } from '../lib/logos';

export interface SlotCardProps {
  readonly slot: Slot;
  readonly pick: WirePick | undefined;
  /** The picked team's game, for the kickoff line. */
  readonly game: Game | undefined;
  readonly team: Team | undefined;
  readonly now: Date;
  /** False once every team in this slot is spoken for or kicked off. */
  readonly canPick: boolean;
  readonly onOpen: () => void;
}

/**
 * One of the three slots, as a single tap target.
 *
 * Everything about the pick is on the card — the team, who it plays, when that locks,
 * and what it has scored — because on a phone this card is often the whole screen. The
 * card is the button; there is no separate edit affordance to hunt for.
 */
export function SlotCard({ slot, pick, game, team, now, canPick, onOpen }: SlotCardProps) {
  const locked =
    pick?.locked === true || (game !== undefined && now.getTime() >= game.kickoff.getTime());
  const interactive = !locked && canPick;

  const body = (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 2 }}>
      {pick === undefined ? <SlotBadge slot={slot} /> : <LogoBadge slot={slot} team={team} />}

      <Box flexGrow={1} minWidth={0}>
        {pick === undefined ? (
          <EmptySlot canPick={canPick} />
        ) : (
          <FilledSlot pick={pick} game={game} team={team} now={now} />
        )}
      </Box>

      {locked ? (
        <LockIcon color="disabled" titleAccess="Locked — this game has kicked off" />
      ) : (
        interactive && <ChevronRightIcon color="action" />
      )}
    </Stack>
  );

  if (!interactive) {
    return (
      <Card variant="outlined" sx={{ opacity: locked ? 0.85 : 1 }}>
        {body}
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen} aria-label={`${SLOT_LABELS[slot]} slot`}>
        {body}
      </CardActionArea>
    </Card>
  );
}

function SlotBadge({ slot }: { slot: Slot }) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{
        width: 56,
        height: 56,
        flexShrink: 0,
        borderRadius: 2,
        bgcolor: `slot.${slot}.main`,
        color: `slot.${slot}.contrastText`,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, lineHeight: 1 }}>
        {SLOT_LABELS[slot]}
      </Typography>
      <Typography variant="caption" sx={{ opacity: 0.9, lineHeight: 1.4 }}>
        {SLOT_POINTS[slot]} {SLOT_POINTS[slot] === 1 ? 'pt' : 'pts'}
      </Typography>
    </Stack>
  );
}

/**
 * The badge for a filled slot: the team logo on a tinted square, with points as a
 * quiet number in the corner.
 *
 * The slot *colour* still encodes win/place/show — that's the hierarchy a glance reads
 * — so the WIN/PLACE/SHOW words step aside for the logo. Empty slots keep the labeled
 * `SlotBadge`, since there's no team to show and the word still says what the slot is.
 */
function LogoBadge({ slot, team }: { slot: Slot; team: Team | undefined }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 56,
        height: 56,
        flexShrink: 0,
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.slot[slot].main, 0.12),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        component="img"
        src={team === undefined ? '' : teamLogoUrl(team.code)}
        alt={team === undefined ? '' : team.name}
        sx={{ width: 40, height: 40, objectFit: 'contain' }}
      />
      <Box
        sx={{
          position: 'absolute',
          right: -4,
          bottom: -4,
          minWidth: 20,
          height: 20,
          px: 0.5,
          borderRadius: 10,
          bgcolor: `slot.${slot}.main`,
          color: `slot.${slot}.contrastText`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 11,
          lineHeight: 1,
          // Match the card surface so the pill reads as a notch on the tile, not a
          // separate element floating over it.
          border: (theme) => `2px solid ${theme.palette.background.paper}`,
        }}
      >
        {SLOT_POINTS[slot]}
      </Box>
    </Box>
  );
}

function EmptySlot({ canPick }: { canPick: boolean }) {
  return (
    <>
      <Typography variant="h3" color="text.disabled">
        No pick
      </Typography>
      {/*
        Rule 9: a pick not made before kickoff cannot be made at all. Saying so is the
        difference between "you missed it" and a slot that looks broken.
      */}
      <Typography variant="body2" color="text.secondary">
        {canPick ? 'Tap to choose a team' : 'Nothing left to pick — every game has kicked off'}
      </Typography>
    </>
  );
}

function FilledSlot({
  pick,
  game,
  team,
  now,
}: {
  pick: WirePick;
  game: Game | undefined;
  team: Team | undefined;
  now: Date;
}) {
  const opponent =
    game === undefined
      ? undefined
      : game.homeTeam === pick.teamId
        ? `vs ${game.awayTeam}`
        : `@ ${game.homeTeam}`;

  return (
    <>
      <Stack direction="row" alignItems="baseline" spacing={1} minWidth={0}>
        <Typography variant="h3">{pick.teamId}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {team?.shortName ?? ''} {opponent ?? ''}
        </Typography>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={0.75} mt={0.5} flexWrap="wrap" useFlexGap>
        <OutcomeChip pick={pick} />
        {pick.source === 'import' && (
          // Imported picks are visibly marked: this one came off the commissioner's
          // workbook, not from this player tapping a button.
          <Chip label="Imported" size="small" variant="outlined" />
        )}
        {game !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {formatKickoff(game.kickoff)}
            {now.getTime() < game.kickoff.getTime() && ` · ${formatCountdown(game.kickoff, now)}`}
          </Typography>
        )}
      </Stack>
    </>
  );
}

function OutcomeChip({ pick }: { pick: WirePick }) {
  switch (pick.outcome) {
    case 'win':
      return <Chip label={`Won +${String(pick.points)}`} size="small" color="success" />;
    case 'loss':
      // Rule 7: a tie is a loss, and it is scored and shown as one.
      return <Chip label="Lost" size="small" color="error" variant="outlined" />;
    case 'pending':
      return <Chip label="Not final" size="small" variant="outlined" />;
    case 'empty':
      return null;
    default:
      return null;
  }
}
