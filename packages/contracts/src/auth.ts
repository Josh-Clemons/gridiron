import { z } from 'zod';
import { idSchema, instantSchema } from './common';

/**
 * Stored and compared lower-cased. Length is the only strength requirement — a
 * character-class rule mostly teaches people to write `Password1!`, and Argon2id
 * plus a server-side session does the real work.
 */
export const emailSchema = z.email().trim().toLowerCase().max(254);

export const passwordSchema = z.string().min(10).max(200);

export const displayNameSchema = z.string().trim().min(1).max(60);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
});

/** The authenticated user. Deliberately no password hash, and no other user's email. */
export const userSchema = z.object({
  id: idSchema,
  email: emailSchema,
  displayName: displayNameSchema,
  isAdmin: z.boolean(),
  createdAt: instantSchema,
});

export const sessionResponseSchema = z.object({
  user: userSchema,
  expiresAt: instantSchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
