import { MemoryMailer } from './memory-mailer';

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * Outbound email.
 *
 * A port with no provider behind it yet: password resets and invites are built and
 * tested against this interface, and choosing an SMTP/API provider (Resend, Postmark,
 * SES) in Phase 5 is a single new implementation of `send` — nothing above this line
 * changes. That keeps the one hard external dependency off the critical path.
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

/** `memory` exists for tests; production picks a real provider in Phase 5. */
export function createMailer(transport: 'console' | 'memory'): Mailer {
  return transport === 'memory' ? new MemoryMailer() : new ConsoleMailer();
}
