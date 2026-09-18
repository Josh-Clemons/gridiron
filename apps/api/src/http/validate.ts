import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest } from './errors';

function fieldsFrom(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    fields[path === '' ? '_' : path] = issue.message;
  }
  return fields;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(`invalid ${what}`, fieldsFrom(result.error));
  }
  return result.data;
}

/**
 * Parse a JSON body.
 *
 * Every request that carries a body goes through this — validation at the boundary,
 * once, rather than defensive checks scattered through the handlers. Handlers below
 * this line only ever see well-formed data.
 */
export async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('body must be JSON');
  }
  return parseOrThrow(schema, body, 'body');
}

export function readQuery<T>(c: Context, schema: z.ZodType<T>): T {
  return parseOrThrow(schema, c.req.query(), 'query');
}

export function readParams<T>(c: Context, schema: z.ZodType<T>): T {
  return parseOrThrow(schema, c.req.param(), 'path');
}

/** A file from a multipart upload, already read into memory. */
export interface UploadedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Validate a multipart file part and read it into memory.
 *
 * The size cap lives in the domain layer, where the workbook-specific limit belongs;
 * this only proves the part is actually a file with a name.
 */
export async function readUploadedFile(value: unknown): Promise<UploadedFile> {
  if (!(value instanceof File)) throw badRequest('file is required');
  if (value.name === '') throw badRequest('file name missing');
  const buffer = await value.arrayBuffer();
  return { name: value.name, bytes: new Uint8Array(buffer) };
}
