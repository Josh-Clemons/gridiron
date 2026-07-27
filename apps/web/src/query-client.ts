import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/client';

/**
 * One place where caching behaviour is decided.
 *
 * The old app configured nothing here and then opted out of refetch-on-focus at three
 * individual call sites, which meant the answer to "when does this refetch" lived in
 * whichever component you happened to be reading. These defaults are the answer for
 * every query in the app; a query that needs something else says so, once, next to
 * itself.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that week navigation is instant, short enough that a board
        // reopened after lunch is refetched rather than shown stale.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // On purpose: kickoffs pass while the tab is in the background, and coming
        // back to a page that still offers a locked team is the one thing this UI
        // must never do.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // A 4xx is an answer. Only network faults and 5xx are worth trying again.
          if (isApiError(error) && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        // Picks are writes with visible consequences; a silent retry could re-apply
        // one the player has already undone.
        retry: false,
      },
    },
  });
}
