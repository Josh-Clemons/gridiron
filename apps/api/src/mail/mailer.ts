import type { Config } from '../config';
import { MemoryMailer } from './memory-mailer';
import { ResendMailer, type ResendConfig } from './resend-mailer';

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Outbound email.
 *
 * A port: password resets and invites are written and tested against this interface,
 * so the provider behind it is one implementation of `send` and nothing above this
 * line knows which one is running. Resend is the production transport; `console` and
 * `memory` cover development and tests.
 */
export interface Mailer {
  send(message: Message): Promise<void>;
}

/** Development transport: prints the message, so reset links are usable locally. */
export class ConsoleMailer implements Mailer {
  send(message: Message): Promise<void> {
    console.info(`[mail] to=${message.to} subject=${message.subject}\n${message.text}`);
    return Promise.resolve();
  }
}

export type MailTransport = 'console' | 'memory' | 'resend';

/**
 * `resend` requires credentials, which {@link loadConfig} has already proven present
 * — an absent `resend` config here would mean the two drifted apart, so it throws
 * rather than quietly falling back to printing reset links into a production log.
 */
export function createMailer(transport: MailTransport, resend?: ResendConfig): Mailer {
  if (transport === 'memory') {
    return new MemoryMailer();
  }
  if (transport === 'resend') {
    if (resend === undefined) {
      throw new Error('MAIL_TRANSPORT=resend requires RESEND_API_KEY and MAIL_FROM');
    }
    return new ResendMailer(resend);
  }
  return new ConsoleMailer();
}

/**
 * The mailer a given configuration asks for.
 *
 * Every entry point should use this rather than calling {@link createMailer} with
 * hand-picked arguments: passing the transport and forgetting the credentials
 * type-checks, and then throws only under `MAIL_TRANSPORT=resend` — which is to say
 * only in production. The sync CLI did exactly that, and every scheduled run would
 * have died before reaching ESPN.
 */
export const mailerFor = (config: Config): Mailer =>
  createMailer(config.mailTransport, config.resend);
