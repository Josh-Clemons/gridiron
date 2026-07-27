/**
 * Recognise a Postgres unique-violation, wherever it's buried.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError`, so the `23505` from postgres.js
 * shows up on the cause rather than the thrown object. Unwrapping the chain keeps
 * "email already registered" a 409 instead of a 500.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let current = error, depth = 0; current !== undefined && depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;

    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };

    if (candidate.code === '23505') {
      return constraint === undefined || candidate.constraint_name === constraint;
    }
    current = candidate.cause;
  }
  return false;
}
