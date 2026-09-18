import {
  type AdminMemberResponse,
  adminMemberResponseSchema,
  type Board,
  correctPickResponseSchema,
  deletePickResponseSchema,
  type League,
  leagueSchema,
  type PutPickResponse,
  putPickResponseSchema,
  regenerateInviteResponseSchema,
  type Slot,
} from '@gridiron/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { reasonForWire } from '../lib/rejections';
import { ApiError, request } from './client';
import { boardQuery, type SeasonArg } from './queries';

const adminMemberPath = (leagueId: number, memberId: number): string =>
  `/leagues/${String(leagueId)}/admin/members/${String(memberId)}`;

const adminPath = (leagueId: number, suffix: string): string =>
  `/leagues/${String(leagueId)}/admin${suffix}`;

export const renameLeague = (leagueId: number, name: string): Promise<League> =>
  request(adminPath(leagueId, '/settings'), {
    method: 'PATCH',
    body: { name },
    schema: leagueSchema,
  });

export const regenerateInvite = (leagueId: number): Promise<{ inviteCode: string }> =>
  request(adminPath(leagueId, '/invite'), {
    method: 'POST',
    schema: regenerateInviteResponseSchema,
  });

export const archiveLeague = (leagueId: number): Promise<League> =>
  request(adminPath(leagueId, '/archive'), { method: 'POST', schema: leagueSchema });

export const unarchiveLeague = (leagueId: number): Promise<League> =>
  request(adminPath(leagueId, '/unarchive'), { method: 'POST', schema: leagueSchema });

export const renameMember = (
  leagueId: number,
  memberId: number,
  displayName: string,
): Promise<AdminMemberResponse> =>
  request(adminMemberPath(leagueId, memberId), {
    method: 'PATCH',
    body: { displayName },
    schema: adminMemberResponseSchema,
  });

export const removeMember = (leagueId: number, memberId: number): Promise<AdminMemberResponse> =>
  request(adminMemberPath(leagueId, memberId), {
    method: 'DELETE',
    schema: adminMemberResponseSchema,
  });

export const restoreMember = (leagueId: number, memberId: number): Promise<AdminMemberResponse> =>
  request(`${adminMemberPath(leagueId, memberId)}/restore`, {
    method: 'POST',
    schema: adminMemberResponseSchema,
  });

export const transferOwnership = (
  leagueId: number,
  memberId: number,
): Promise<AdminMemberResponse> =>
  request(`${adminMemberPath(leagueId, memberId)}/transfer-ownership`, {
    method: 'POST',
    schema: adminMemberResponseSchema,
  });

export const correctMemberPick = (
  leagueId: number,
  memberId: number,
  season: SeasonArg,
  week: number,
  slot: Slot,
  teamId: string | null,
  reason: string,
) =>
  request(
    `${adminMemberPath(leagueId, memberId)}/picks/${String(week)}/${slot}${
      season === undefined ? '' : `?season=${String(season)}`
    }`,
    {
      method: 'PUT',
      body: { teamId, reason },
      schema: correctPickResponseSchema,
    },
  );

interface PickTarget {
  readonly slot: Slot;
  readonly teamId: string;
}

const pickPath = (leagueId: number, season: SeasonArg, week: number, slot: Slot): string =>
  `/leagues/${String(leagueId)}/picks/${String(week)}/${slot}${
    season === undefined ? '' : `?season=${String(season)}`
  }`;

/** Drop a slot's pick and put a new one in, keeping the board's slot order. */
function withPick(board: Board, slot: Slot, teamId: string): Board {
  const others = board.picks.filter((pick) => pick.slot !== slot);
  return {
    ...board,
    picks: [
      ...others,
      {
        slot,
        week: board.week,
        teamId,
        source: 'app',
        // A pick that hasn't kicked off yet is worth nothing yet — the optimistic row
        // claims no points, so the score line can't flicker upward and back.
        outcome: 'pending',
        points: 0,
        locked: false,
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

const withoutPick = (board: Board, slot: Slot): Board => ({
  ...board,
  picks: board.picks.filter((pick) => pick.slot !== slot),
});

/**
 * Making and clearing picks, with no save button anywhere.
 *
 * The write is per slot and the cache is updated before the request leaves, so the
 * grid never shows a spinner for something that is almost always going to succeed —
 * the same rules engine has already agreed the pick is legal. If the server disagrees
 * anyway (a kickoff passed in the last second, most likely) the cache rolls back and
 * the server's own sentence is shown.
 *
 * There is deliberately no dirty state: nothing is ever "typed but unsaved", so
 * nothing can be lost by closing the tab.
 */
export function usePickMutations(leagueId: number, season: SeasonArg, week: number) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const boardKey = boardQuery(leagueId, season, week).queryKey;

  /** After any write, the derived views are stale — refetch, don't recompute. */
  const invalidateDerived = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['board', leagueId] }),
      queryClient.invalidateQueries({ queryKey: ['usage', leagueId] }),
      queryClient.invalidateQueries({ queryKey: ['standings', leagueId] }),
    ]);
  };

  const report = (error: unknown): void => {
    if (error instanceof ApiError) {
      const rejection = error.rejections?.[0];
      toast.show(rejection === undefined ? error.message : reasonForWire(rejection), 'error');
      return;
    }
    toast.show('could not reach the server — your pick was not saved', 'error');
  };

  const setPick = useMutation({
    mutationFn: ({ slot, teamId }: PickTarget) =>
      request(pickPath(leagueId, season, week, slot), {
        method: 'PUT',
        body: { teamId },
        schema: putPickResponseSchema,
      }),
    onMutate: async ({ slot, teamId }: PickTarget) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<Board>(boardKey);
      if (previous !== undefined) {
        queryClient.setQueryData<Board>(boardKey, withPick(previous, slot, teamId));
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(boardKey, context.previous);
      report(error);
    },
    onSuccess: (response: PutPickResponse) => {
      // The server's row replaces the optimistic one — same pick, but with its real
      // source, lock state and timestamp, and the week score it computed alongside.
      queryClient.setQueryData<Board>(boardKey, (board) =>
        board === undefined
          ? board
          : {
              ...board,
              picks: [
                ...board.picks.filter((pick) => pick.slot !== response.pick.slot),
                response.pick,
              ],
              weekScore: response.weekScore,
            },
      );
    },
    onSettled: invalidateDerived,
  });

  const clearPick = useMutation({
    mutationFn: (slot: Slot) =>
      request(pickPath(leagueId, season, week, slot), {
        method: 'DELETE',
        schema: deletePickResponseSchema,
      }),
    onMutate: async (slot: Slot) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<Board>(boardKey);
      if (previous !== undefined)
        queryClient.setQueryData<Board>(boardKey, withoutPick(previous, slot));
      return { previous };
    },
    onError: (error, _slot, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(boardKey, context.previous);
      report(error);
    },
    onSuccess: (response) => {
      queryClient.setQueryData<Board>(boardKey, (board) =>
        board === undefined ? board : { ...board, weekScore: response.weekScore },
      );
    },
    onSettled: invalidateDerived,
  });

  return { setPick, clearPick };
}
