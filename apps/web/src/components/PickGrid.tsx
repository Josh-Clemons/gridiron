import Stack from '@mui/material/Stack';
import type { Board, Team } from '@gridiron/contracts';
import { availableTeamsFor, findGame, type Pick, type Slot, SLOTS } from '@gridiron/rules';
import { useMemo, useState } from 'react';
import { toRulesGames } from '../lib/board';
import { SlotCard } from './SlotCard';
import { TeamPickerDialog } from './TeamPickerDialog';

export interface PickGridProps {
  readonly board: Board;
  /** Every pick this player holds this season — rule 6 can't be checked without it. */
  readonly seasonPicks: readonly Pick[];
  readonly teams: ReadonlyMap<string, Team>;
  /** Server time, ticking. Every lock decision on this page is made against it. */
  readonly now: Date;
  readonly onSelect: (slot: Slot, teamId: string) => void;
  readonly onClear: (slot: Slot) => void;
}

/**
 * The three slots for one week — the centrepiece of the app.
 *
 * There is no save button and no dirty state. Choosing a team fires the write, the
 * cache updates before the request lands, and the only way to lose a pick is to make
 * another one.
 */
export function PickGrid({ board, seasonPicks, teams, now, onSelect, onClear }: PickGridProps) {
  const [openSlot, setOpenSlot] = useState<Slot | undefined>();

  const games = useMemo(() => toRulesGames(board.games), [board.games]);

  const picksBySlot = useMemo(
    () => new Map(board.picks.map((pick) => [pick.slot, pick])),
    [board.picks],
  );

  /**
   * Whether each slot still has anything legal in it.
   *
   * Once every remaining team is used, playing, or kicked off, the slot is closed for
   * the week and says so, rather than opening a dialog with nothing selectable in it.
   */
  const openSlots = useMemo(
    () =>
      new Map(
        SLOTS.map((slot) => [
          slot,
          availableTeamsFor({ seasonPicks, games, week: board.week, slot, now }).some(
            (option) => option.selectable,
          ),
        ]),
      ),
    [seasonPicks, games, board.week, now],
  );

  const current = openSlot === undefined ? undefined : picksBySlot.get(openSlot);

  return (
    <>
      <Stack spacing={1.5}>
        {SLOTS.map((slot) => {
          const pick = picksBySlot.get(slot);
          return (
            <SlotCard
              key={slot}
              slot={slot}
              pick={pick}
              game={pick === undefined ? undefined : findGame(games, board.week, pick.teamId)}
              team={pick === undefined ? undefined : teams.get(pick.teamId)}
              now={now}
              canPick={openSlots.get(slot) ?? false}
              onOpen={() => {
                setOpenSlot(slot);
              }}
            />
          );
        })}
      </Stack>

      {openSlot !== undefined && (
        <TeamPickerDialog
          open
          slot={openSlot}
          week={board.week}
          games={games}
          seasonPicks={seasonPicks}
          now={now}
          teams={teams}
          currentTeamId={current?.teamId}
          onSelect={(teamId) => {
            onSelect(openSlot, teamId);
            setOpenSlot(undefined);
          }}
          onClear={() => {
            onClear(openSlot);
            setOpenSlot(undefined);
          }}
          onClose={() => {
            setOpenSlot(undefined);
          }}
        />
      )}
    </>
  );
}
