import {
  type AdminMember,
  type AdminMembersResponse,
  adminMembersResponseSchema,
  type Board,
  boardSchema,
  type Champions,
  championsSchema,
  correctionsResponseSchema,
  type CorrectionsResponse,
  type CreateLeagueRequest,
  type JoinLeagueRequest,
  type JoinPreview,
  joinPreviewSchema,
  type League,
  type LeagueMember,
  leagueMemberSchema,
  leagueSchema,
  type LoginRequest,
  type RegisterRequest,
  type SeasonHistory,
  seasonHistorySchema,
  type Seasons,
  seasonsSchema,
  type SessionResponse,
  sessionResponseSchema,
  type Standings,
  standingsSchema,
  type Team,
  type TeamUsage,
  teamUsageSchema,
  teamsResponseSchema,
  type Workbook,
  type WorkbooksResponse,
  workbooksResponseSchema,
  userSchema,
} from '@gridiron/contracts';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, request, requestVoid } from './client';

const leaguesResponseSchema = z.object({ leagues: z.array(leagueSchema) });
const membersResponseSchema = z.object({ members: z.array(leagueMemberSchema) });
const meResponseSchema = z.object({ user: userSchema });

/**
 * A league is always addressed with an optional season, which defaults server-side to
 * the newest one. `'current'` stands in for "whatever the server says" in the cache key
 * so the live season and an explicitly requested one never share an entry.
 */
export type SeasonArg = number | undefined;

const seasonKey = (season: SeasonArg): number | 'current' => season ?? 'current';

const seasonQuery = (season: SeasonArg): string =>
  season === undefined ? '' : `season=${String(season)}`;

function query(...parts: (string | undefined)[]): string {
  const joined = parts.filter((part) => part !== undefined && part !== '').join('&');
  return joined === '' ? '' : `?${joined}`;
}

/**
 * Reference data for the whole app: 32 rows that change when a franchise moves.
 *
 * Fetched once and never refetched — `staleTime: Infinity` — which is the shape the
 * old app never had. It re-filtered a 576-row competitor list inside a `useEffect` on
 * every render of every one of its 54 selects.
 */
export const teamsQuery = () =>
  queryOptions({
    queryKey: ['teams'] as const,
    queryFn: ({ signal }) =>
      request('/teams', { schema: teamsResponseSchema, signal }).then((data) => data.teams),
    staleTime: Infinity,
    gcTime: Infinity,
  });

/**
 * Who is signed in, or `null`.
 *
 * A 401 is an answer, not a failure: it means "nobody", and the route guard reads it
 * as such. Anything else is a real error and propagates.
 */
export const sessionQuery = () =>
  queryOptions({
    queryKey: ['session'] as const,
    queryFn: async ({ signal }) => {
      try {
        const data = await request('/auth/me', { schema: meResponseSchema, signal });
        return data.user;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

export const leaguesQuery = () =>
  queryOptions({
    queryKey: ['leagues'] as const,
    queryFn: ({ signal }) =>
      request('/leagues', { schema: leaguesResponseSchema, signal }).then((data) => data.leagues),
  });

export const leagueQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['league', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}`, { schema: leagueSchema, signal }),
  });

export const membersQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['members', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/members`, {
        schema: membersResponseSchema,
        signal,
      }).then((data) => data.members),
  });

export const adminMembersQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['admin-members', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/admin/members`, {
        schema: adminMembersResponseSchema,
        signal,
      }).then((data) => data.members),
  });

export const correctionsQuery = (leagueId: number, season: SeasonArg) =>
  queryOptions({
    queryKey: ['corrections', leagueId, seasonKey(season)] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/admin/corrections${query(seasonQuery(season))}`, {
        schema: correctionsResponseSchema,
        signal,
      }),
  });

export const adminWorkbooksQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['admin-workbooks', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/admin/workbooks`, {
        schema: workbooksResponseSchema,
        signal,
      }).then((data) => data.workbooks),
  });

export const joinPreviewQuery = (code: string) =>
  queryOptions({
    queryKey: ['join-preview', code] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/preview?code=${encodeURIComponent(code)}`, {
        schema: joinPreviewSchema,
        signal,
      }),
    enabled: code.length === 8,
    retry: false,
  });

/**
 * One week of the board.
 *
 * `week: undefined` asks the server which week is live; the pick page then rewrites the
 * URL with the answer so every later fetch, and every optimistic write, addresses a
 * known key.
 */
export const boardQuery = (leagueId: number, season: SeasonArg, week: number | undefined) =>
  queryOptions({
    queryKey: ['board', leagueId, seasonKey(season), week ?? 'current'] as const,
    queryFn: ({ signal }) =>
      request(
        `/leagues/${String(leagueId)}/board${query(seasonQuery(season), week === undefined ? undefined : `week=${String(week)}`)}`,
        { schema: boardSchema, signal },
      ),
  });

/** Every team still spendable in each slot — the strategic heart of the game. */
export const usageQuery = (leagueId: number, season: SeasonArg) =>
  queryOptions({
    queryKey: ['usage', leagueId, seasonKey(season)] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/usage${query(seasonQuery(season))}`, {
        schema: teamUsageSchema,
        signal,
      }),
  });

export const standingsQuery = (leagueId: number, season: SeasonArg, week: number | undefined) =>
  queryOptions({
    queryKey: ['standings', leagueId, seasonKey(season), week ?? 'current'] as const,
    queryFn: ({ signal }) =>
      request(
        `/leagues/${String(leagueId)}/standings${query(seasonQuery(season), week === undefined ? undefined : `week=${String(week)}`)}`,
        { schema: standingsSchema, signal },
      ),
  });

/**
 * Which seasons this league can show.
 *
 * Rarely changes — a year appears when its schedule is synced or a workbook is
 * imported — so it is cached for the session and shared by every season picker.
 */
export const seasonsQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['seasons', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/seasons`, { schema: seasonsSchema, signal }).then(
        (data) => data.seasons,
      ),
    staleTime: 5 * 60_000,
  });

/** A whole season as a member × week grid — the one view that isn't week-at-a-time. */
export const historyQuery = (leagueId: number, season: SeasonArg) =>
  queryOptions({
    queryKey: ['history', leagueId, seasonKey(season)] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/history${query(seasonQuery(season))}`, {
        schema: seasonHistorySchema,
        signal,
      }),
  });

/**
 * The honours board, back to 2007.
 *
 * Only the importer writes it, and only when the commissioner loads a workbook, so it
 * is treated as reference data rather than something to refetch on every visit.
 */
export const championsQuery = (leagueId: number) =>
  queryOptions({
    queryKey: ['champions', leagueId] as const,
    queryFn: ({ signal }) =>
      request(`/leagues/${String(leagueId)}/champions`, { schema: championsSchema, signal }),
    staleTime: 5 * 60_000,
  });

export const login = (body: LoginRequest): Promise<SessionResponse> =>
  request('/auth/login', { method: 'POST', body, schema: sessionResponseSchema });

export const register = (body: RegisterRequest): Promise<SessionResponse> =>
  request('/auth/register', { method: 'POST', body, schema: sessionResponseSchema });

export const logout = (): Promise<void> => requestVoid('/auth/logout', { method: 'POST' });

/**
 * Always succeeds, whether or not the address has an account. The API refuses to say
 * which addresses are registered, and there is nothing in the body worth reading.
 */
export const forgotPassword = (email: string): Promise<void> =>
  requestVoid('/auth/forgot-password', { method: 'POST', body: { email } });

/** Redeeming a token signs you in, so this answers with a session like `login` does. */
export const resetPassword = (token: string, password: string): Promise<SessionResponse> =>
  request('/auth/reset-password', {
    method: 'POST',
    body: { token, password },
    schema: sessionResponseSchema,
  });

export const createLeague = (body: CreateLeagueRequest): Promise<League> =>
  request('/leagues', { method: 'POST', body, schema: leagueSchema });

export const joinLeague = (body: JoinLeagueRequest): Promise<League> =>
  request('/leagues/join', { method: 'POST', body, schema: leagueSchema });

export const leaveLeague = (leagueId: number): Promise<void> =>
  requestVoid(`/leagues/${String(leagueId)}/leave`, { method: 'POST' });

export type {
  AdminMember,
  AdminMembersResponse,
  Board,
  Champions,
  CorrectionsResponse,
  JoinPreview,
  League,
  LeagueMember,
  SeasonHistory,
  Seasons,
  Standings,
  Team,
  TeamUsage,
  Workbook,
  WorkbooksResponse,
};
