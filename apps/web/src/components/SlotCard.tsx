import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LockIcon from '@mui/icons-material/Lock';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Pick as WirePick, Team } from '@gridiron/contracts';
import { type Game, type Slot, SLOT_LABELS, SLOT_POINTS } from '@gridiron/rules';
import { formatCountdown, formatKickoff } from '../lib/format';

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
      <SlotBadge slot={slot} />

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
