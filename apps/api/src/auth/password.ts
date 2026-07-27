import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's low-memory Argon2id profile: 19 MiB, two passes, one lane.
 *
 * `@node-rs/argon2` defaults to Argon2id, which is the variant we want — the old app
 * used BCrypt with Spring's default cost and stored the result next to a 300-day JWT.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Check a password against a stored hash.
 *
 * A malformed or truncated hash verifies as `false` rather than throwing, so a
 * corrupt row can't turn a failed login into a 500 that tells an attacker the account
 * exists.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
