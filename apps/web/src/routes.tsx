import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { sessionQuery } from './api/queries';
import { AppShell } from './components/AppShell';
import { ChampionsPage } from './pages/ChampionsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { HistoryPage } from './pages/HistoryPage';
import { JoinPage } from './pages/JoinPage';
import { LeagueLayout } from './pages/LeagueLayout';
import { LeaguesPage } from './pages/LeaguesPage';
import { LoginPage } from './pages/LoginPage';
import { PickPage } from './pages/PickPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { StandingsPage } from './pages/StandingsPage';
import { UsagePage } from './pages/UsagePage';

export interface RouterContext {
  readonly queryClient: QueryClient;
}

/**
 * Search parameters are parsed, not trusted.
 *
 * `?week=abc` is a link someone typed wrong, not a crash: nonsense is dropped and the
 * page falls back to the live week. The bounds are loose on purpose — the real limit is
 * the season's own `weekCount`, which only the server knows, and the API rejects
 * anything past it anyway.
 */
function boundedInt(value: unknown, min: number, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Both keys are genuinely optional: omitting `week` means "the live one" and omitting
 * `season` means "the newest", which is what a bare link to a league should do. So a
 * missing value is left out of the object entirely rather than set to `undefined` —
 * that's the difference between a link that needs no search params and one that does.
 */
export interface WeekSearch {
  readonly week?: number;
  readonly season?: number;
}

export type SeasonSearch = Pick<WeekSearch, 'season'>;

const weekSearch = (search: Record<string, unknown>): WeekSearch => {
  const week = boundedInt(search.week, 1, 25);
  return { ...seasonSearch(search), ...(week === undefined ? {} : { week }) };
};

const seasonSearch = (search: Record<string, unknown>): SeasonSearch => {
  const season = boundedInt(search.season, 2007, 2100);
  return season === undefined ? {} : { season };
};

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // The router signals a redirect by throwing a plain object rather than an Error.
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: '/leagues' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>) => {
    // Where to go after signing in — set by the guard below when it turns someone away.
    const target = text(search.redirect);
    return target === undefined ? {} : { redirect: target };
  },
  component: LoginPage,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (search: Record<string, unknown>) => {
    const token = text(search.token);
    return token === undefined ? {} : { token };
  },
  component: ResetPasswordPage,
});

/**
 * Everything behind a session.
 *
 * The check runs before the route renders, so a signed-out visitor never sees a
 * flash of a league page followed by a redirect. `ensureQueryData` means the answer
 * is fetched once and shared with every component that asks who is signed in.
 */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(sessionQuery());
    if (user === null) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    return { user };
  },
  component: AppShell,
});

const leaguesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/leagues',
  component: LeaguesPage,
});

const joinRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/join',
  validateSearch: (search: Record<string, unknown>) => {
    const code = text(search.code);
    return code === undefined ? {} : { code };
  },
  component: JoinPage,
});

const leagueRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/leagues/$leagueId',
  component: LeagueLayout,
});

const pickRoute = createRoute({
  getParentRoute: () => leagueRoute,
  path: '/',
  validateSearch: weekSearch,
  component: PickPage,
});

const usageRoute = createRoute({
  getParentRoute: () => leagueRoute,
  path: '/usage',
  validateSearch: seasonSearch,
  component: UsagePage,
});

const standingsRoute = createRoute({
  getParentRoute: () => leagueRoute,
  path: '/standings',
  validateSearch: weekSearch,
  component: StandingsPage,
});

const historyRoute = createRoute({
  getParentRoute: () => leagueRoute,
  path: '/history',
  validateSearch: seasonSearch,
  component: HistoryPage,
});

/** No search parameters: the honours board spans every season at once. */
const championsRoute = createRoute({
  getParentRoute: () => leagueRoute,
  path: '/champions',
  component: ChampionsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  authedRoute.addChildren([
    leaguesRoute,
    joinRoute,
    leagueRoute.addChildren([pickRoute, usageRoute, standingsRoute, historyRoute, championsRoute]),
  ]),
]);
