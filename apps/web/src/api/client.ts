import { type ErrorCode, errorResponseSchema, type PickRejectionWire } from '@gridiron/contracts';
import type { z } from 'zod';

/**
 * Same-origin by default: `/api` is what Caddy proxies in production and what the Vite
 * dev server proxies locally, so the session cookie is first-party in both.
 */
const configuredBaseUrl: unknown = import.meta.env.VITE_API_URL;
const BASE_URL: string =
  typeof configuredBaseUrl === 'string' && configuredBaseUrl !== '' ? configuredBaseUrl : '/api';

/**
 * A failed request, carrying the API's own error envelope.
 *
 * `rejections` is the interesting one: when a pick breaks a rule the server sends back
 * every rule it broke, each with the wording `describeRejection` produced. The UI shows
 * that text verbatim rather than restating the rule, so the two can never disagree.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Readonly<Record<string, string>> | undefined;
  readonly rejections: readonly PickRejectionWire[] | undefined;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    detail: {
      fields?: Readonly<Record<string, string>>;
      rejections?: readonly PickRejectionWire[];
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = detail.fields;
    this.rejections = detail.rejections;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** True for the one error every screen has to handle: the session is gone. */
export const isUnauthorized = (error: unknown): boolean =>
  isApiError(error) && error.code === 'unauthorized';

interface SendOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

interface RequestOptions<T> extends SendOptions {
  /** Parsed against the shared contract, so server drift surfaces here and not later. */
  readonly schema: z.ZodType<T>;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return new ApiError(response.status, 'internal', `request failed (${String(response.status)})`);
  }

  const { code, message, fields, rejections } = parsed.data.error;
  return new ApiError(response.status, code, message, {
    ...(fields === undefined ? {} : { fields }),
    ...(rejections === undefined ? {} : { rejections }),
  });
}

/**
 * Every call to the API goes through here.
 *
 * `credentials: 'include'` is the only reason auth works: the session is an httpOnly
 * cookie the JavaScript can't read, which is the point — the old app kept a 300-day
 * JWT in a cookie any script on the page could lift.
 */
async function send(path: string, options: SendOptions): Promise<Response> {
  const { method = 'GET', body, signal } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) throw await toApiError(response);
  return response;
}

/**
 * A request whose response is parsed against a contract.
 *
 * The schema is required rather than optional, so there is no way to read a response
 * without saying what it should look like. A server that drifts fails here, in one
 * place, naming the field — the same discipline the ESPN sync uses on the way in.
 */
export async function request<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const response = await send(path, options);
  const payload: unknown = await response.json();

  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, 'internal', `unexpected response from ${path}`, {
      fields: { _: parsed.error.issues[0]?.message ?? 'shape mismatch' },
    });
  }
  return parsed.data;
}

/** A request whose response body is of no interest — a 204, or a bare acknowledgement. */
export async function requestVoid(path: string, options: SendOptions = {}): Promise<void> {
  await send(path, options);
}

/** A multipart POST — the content-type and boundary are left to `fetch`. */
export async function requestForm<T>(
  path: string,
  form: FormData,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!response.ok) throw await toApiError(response);

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, 'internal', `unexpected response from ${path}`, {
      fields: { _: parsed.error.issues[0]?.message ?? 'shape mismatch' },
    });
  }
  return parsed.data;
}

/** A download: the response is a file, not JSON. Returns the bytes and the filename. */
export async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${BASE_URL}${path}`, { credentials: 'include' });
  if (!response.ok) throw await toApiError(response);

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition');
  const filename = disposition === null ? null : /filename="([^"]*)"/u.exec(disposition)?.[1];
  return { blob, filename: filename ?? 'download' };
}
