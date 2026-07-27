import type { ErrorCode, ErrorResponse, PickRejectionWire } from '@gridiron/contracts';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  pick_rejected: 422,
  rate_limited: 429,
  internal: 500,
};

export interface ApiErrorOptions {
  readonly fields?: Readonly<Record<string, string>>;
  readonly rejections?: readonly PickRejectionWire[];
  readonly cause?: unknown;
}

/**
 * The only error type routes throw.
 *
 * Carrying the wire `code` means the HTTP status and the JSON body can never
 * disagree, and it keeps handlers free of response plumbing.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields: Readonly<Record<string, string>> | undefined;
  readonly rejections: readonly PickRejectionWire[] | undefined;

  constructor(code: ErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.fields = options.fields;
    this.rejections = options.rejections;
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }

  toResponseBody(): ErrorResponse {
    const error: ErrorResponse['error'] = { code: this.code, message: this.message };
    if (this.fields !== undefined) error.fields = this.fields;
    if (this.rejections !== undefined) error.rejections = [...this.rejections];
    return { error };
  }
}

export const badRequest = (message: string, fields?: Record<string, string>): ApiError =>
  new ApiError('bad_request', message, fields === undefined ? {} : { fields });

export const unauthorized = (message = 'not signed in'): ApiError =>
  new ApiError('unauthorized', message);

export const forbidden = (message = 'not allowed'): ApiError => new ApiError('forbidden', message);

export const notFound = (message = 'not found'): ApiError => new ApiError('not_found', message);

export const conflict = (message: string): ApiError => new ApiError('conflict', message);

export const pickRejected = (rejections: readonly PickRejectionWire[]): ApiError =>
  new ApiError('pick_rejected', rejections[0]?.message ?? 'pick not allowed', { rejections });

/**
 * Turn anything thrown in a handler into the standard envelope.
 *
 * Unrecognised errors become a bare 500: the message is logged server-side and never
 * returned, so an internal failure can't leak a query, a path, or a stack trace to a
 * caller.
 */
export function errorHandler(error: unknown, c: Context): Response {
  if (error instanceof ApiError) {
    return c.json(error.toResponseBody(), error.status);
  }
  if (error instanceof HTTPException) {
    const code: ErrorCode = error.status === 404 ? 'not_found' : 'bad_request';
    return c.json(
      { error: { code, message: error.message } } satisfies ErrorResponse,
      error.status,
    );
  }
  console.error('unhandled error', error);
  return c.json(
    { error: { code: 'internal', message: 'internal error' } } satisfies ErrorResponse,
    500,
  );
}

export function notFoundHandler(c: Context): Response {
  return c.json(
    { error: { code: 'not_found', message: 'no such route' } } satisfies ErrorResponse,
    404,
  );
}
