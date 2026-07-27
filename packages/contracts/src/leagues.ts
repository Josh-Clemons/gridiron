import { z } from 'zod';
import { displayNameSchema } from './auth';
import { idSchema, instantSchema, memberRoleSchema } from './common';

/**
 * Invite codes are generated server-side from an unambiguous alphabet (no I, O, 0 or
 * 1) because they get read aloud and retyped from a phone. Accepted case-insensitively
 * and normalised here so the client never has to care.
 */
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/u, 'not an invite code');

export const leagueNameSchema = z.string().trim().min(1).max(80);

export const createLeagueRequestSchema = z.object({
  name: leagueNameSchema,
});

export const leagueSchema = z.object({
  id: idSchema,
  name: leagueNameSchema,
  /** Members only — this is the credential for joining. */
  inviteCode: inviteCodeSchema,
  memberCount: z.int().nonnegative(),
  /** The caller's own membership, which is what picks hang off. */
  memberId: idSchema,
  role: memberRoleSchema,
  createdAt: instantSchema,
  archivedAt: instantSchema.nullable(),
});

export const leagueMemberSchema = z.object({
  id: idSchema,
  displayName: displayNameSchema,
  role: memberRoleSchema,
  /**
   * False for a roster slot the importer created from the spreadsheet that no account
   * has claimed yet. Those players exist in the league and have picks and standings
   * long before they ever register.
   */
  claimed: z.boolean(),
  isSelf: z.boolean(),
  joinedAt: instantSchema,
});

/**
 * What an invite code shows you *before* you commit to joining.
 *
 * The unclaimed list is how a spreadsheet player takes ownership of the history the
 * importer already loaded for them. It carries display names only — no emails, and
 * nothing about members who are already claimed.
 */
export const joinPreviewSchema = z.object({
  league: z.object({
    id: idSchema,
    name: leagueNameSchema,
    memberCount: z.int().nonnegative(),
  }),
  unclaimedMembers: z.array(
    z.object({
      id: idSchema,
      displayName: displayNameSchema,
      pickCount: z.int().nonnegative(),
    }),
  ),
  /** True when the caller is already in this league; joining again is a no-op. */
  alreadyMember: z.boolean(),
});

export const joinLeagueRequestSchema = z.object({
  inviteCode: inviteCodeSchema,
  /**
   * Claim an existing unclaimed roster slot, inheriting its picks and standings.
   * Omit to join as a brand-new member.
   */
  claimMemberId: idSchema.optional(),
  /** Roster name for a new membership. Defaults to the account's display name. */
  displayName: displayNameSchema.optional(),
});

export type League = z.infer<typeof leagueSchema>;
export type LeagueMember = z.infer<typeof leagueMemberSchema>;
export type JoinPreview = z.infer<typeof joinPreviewSchema>;
export type CreateLeagueRequest = z.infer<typeof createLeagueRequestSchema>;
export type JoinLeagueRequest = z.infer<typeof joinLeagueRequestSchema>;
