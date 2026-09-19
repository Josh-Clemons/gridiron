import { z } from 'zod';
import { idSchema, instantSchema } from './common';

/**
 * Stored and compared lower-cased. Length is the only strength requirement — a
 * character-class rule mostly teaches people to write `Password1!`, and Argon2id
 * plus a server-side session does the real work.
 */
export const emailSchema = z.email().trim().toLowerCase().max(254);

/**
 * Exported so the sign-up and reset forms can state the rule in their helper text
 * without hard-coding a number that would silently drift from the one enforced here.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(200);

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

/**
 * The signed-in player's own settings.
 *
 * Both fields are always sent — the form shows the current values and saves them back
 * together. `displayName` is the default roster label for leagues created or joined
 * from now on; existing league labels are the commissioner's, never touched here.
 */
export const updateProfileRequestSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
});

/**
 * Changing a password requires proving the current one.
 *
 * A session is proof of identity only up to the moment the browser is left unlocked;
 * requiring the old password means a hijacked session can't silently lock the owner
 * out.
 */
export const changePasswordRequestSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
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
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
