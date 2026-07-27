import type { Mailer, Message } from './mailer';

/**
 * Test transport: keeps everything in memory so assertions can read it back.
 *
 * Lets the password-reset tests pull the real token out of the real message the real
 * route composed, rather than reaching into the database for it.
 */
export class MemoryMailer implements Mailer {
  readonly sent: Message[] = [];

  send(message: Message): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  lastTo(email: string): Message | undefined {
    const target = email.toLowerCase();
    return this.sent.findLast((message) => message.to.toLowerCase() === target);
  }

  clear(): void {
    this.sent.length = 0;
  }
}
