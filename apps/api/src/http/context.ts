import type { SessionUser } from '../auth/sessions';

/**
 * Request-scoped state.
 *
 * `user` is set only by `requireAuth`, so any handler that reads it is provably behind
 * authentication. This is the mechanism that fixes the old app's central bug: the
 * acting user is taken from the session here, never from the request body.
 */
export interface AppEnv {
  Variables: {
    user: SessionUser;
    sessionId: number;
  };
}
