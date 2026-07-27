import type { Config } from '../config';
import { MatrixAlerter } from './matrix-alerter';

export interface Alert {
  readonly subject: string;
  readonly detail: string;
}

/**
 * Where a failed sync goes to be noticed.
 *
 * ESPN's endpoint is undocumented and unversioned, so the realistic failure isn't a
 * crash — it's a sync that quietly stops returning games while the season carries on
 * and everyone's picks silently score zero. A sync that fails has to be loud.
 */
export interface Alerter {
  send(alert: Alert): Promise<void>;
}

/** Default: stderr, which cron mails to the local user. */
export class ConsoleAlerter implements Alerter {
  send(alert: Alert): Promise<void> {
    console.error(`[alert] ${alert.subject}\n${alert.detail}`);
    return Promise.resolve();
  }
}

/**
 * Matrix when it's configured, stderr otherwise.
 *
 * Phase 5 supplies the homeserver, bot token and `#alerts:jdclemons.dev` room id from
 * `~/.config/gridiron.env`. Until then this stays on the console, which keeps Phase 3
 * from depending on credentials that don't exist yet.
 */
export function createAlerter(config: Config): Alerter {
  const { matrix } = config;
  if (matrix === undefined) return new ConsoleAlerter();
  return new MatrixAlerter(matrix);
}
