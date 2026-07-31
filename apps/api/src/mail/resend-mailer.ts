import type { Mailer, Message } from './mailer';

export interface ResendConfig {
  readonly apiKey: string;
  /** RFC 5322 sender, e.g. `Gridiron <noreply@mail.gridironpicks.us>`. */
  readonly from: string;
}

/**
 * Outbound email via Resend's HTTP API.
 *
 * An HTTP POST rather than SMTP, which is why this needs no transport library: one
 * `fetch` against a documented JSON endpoint. The sending domain must be verified in
 * the Resend dashboard first — an unverified `from` is rejected at send time, not at
 * startup, so a misconfigured deploy fails on the first password reset.
 *
 * Unlike {@link MatrixAlerter}, a failure here *throws*. An alert that can't be
 * delivered is worth swallowing to preserve the underlying error; a password reset
 * that silently vanishes leaves a player locked out with no signal anywhere.
 */
export class ResendMailer implements Mailer {
  constructor(private readonly config: ResendConfig) {}

  async send(message: Message): Promise<void> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      });
    } catch (error) {
      throw new Error(`resend unreachable: ${String(error)}`, { cause: error });
    }

    if (!response.ok) {
      // Resend answers errors with a JSON body, but a gateway in front of it may not.
      const detail = await response.text().catch(() => '');
      throw new Error(`resend returned ${String(response.status)}: ${detail}`);
    }
  }
}
