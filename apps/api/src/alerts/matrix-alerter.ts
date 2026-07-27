import { randomUUID } from 'node:crypto';
import type { Alert, Alerter } from './alerter';

export interface MatrixConfig {
  readonly homeserver: string;
  readonly accessToken: string;
  readonly roomId: string;
}

/**
 * Post an alert into a Matrix room.
 *
 * Uses the same bot-token mechanism the other services on this machine already use;
 * the homeserver is local, so this is a request to 127.0.0.1. A failure to *send* an
 * alert falls back to stderr rather than throwing — losing the sync's real error
 * because the notifier broke would be the worst possible trade.
 */
export class MatrixAlerter implements Alerter {
  constructor(private readonly config: MatrixConfig) {}

  async send(alert: Alert): Promise<void> {
    const url = `${this.config.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
      this.config.roomId,
    )}/send/m.room.message/${randomUUID()}`;

    try {
      const response = await fetch(url, {
        method: 'PUT',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: `🏈 ${alert.subject}\n${alert.detail}`,
        }),
      });

      if (!response.ok) {
        console.error(`[alert] matrix returned ${String(response.status)}`);
        console.error(`[alert] ${alert.subject}\n${alert.detail}`);
      }
    } catch (error) {
      console.error('[alert] could not reach matrix', error);
      console.error(`[alert] ${alert.subject}\n${alert.detail}`);
    }
  }
}
