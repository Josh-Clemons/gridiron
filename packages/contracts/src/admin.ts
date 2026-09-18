import { z } from 'zod';
import { displayNameSchema } from './auth';
import {
  idSchema,
  instantSchema,
  seasonYearSchema,
  slotSchema,
  memberRoleSchema,
  teamCodeSchema,
  weekSchema,
} from './common';
import { pickSchema, seasonSchema, weekScoreSchema } from './picks';
import { inviteCodeSchema, leagueNameSchema } from './leagues';

/**
 * Commissioner tools — Phase 7.
 *
 * These contracts are deliberately separate from `picks.ts`: a correction is a
 * different act from a pick. The player writes their own slots; the owner writes
 * anyone's, after kickoff if need be, and every act is logged with a reason. The
 * schemas here describe that act.
 */

/** Correcting one slot of any member's week. */
export const correctPickRequestSchema = z.object({
  /** The team to write, or `null` to clear the slot — a pick that should score 0. */
  teamId: teamCodeSchema.nullable(),
  /** Why. Required and never edited after; the audit trail is the point of the feature. */
  reason: z.string().trim().min(3).max(500),
});

/** One row of the correction log, as the owner reads it. */
export const correctionSchema = z.object({
  id: idSchema,
  actorMemberId: idSchema,
  actorName: displayNameSchema,
  targetMemberId: idSchema,
  targetName: displayNameSchema,
  /** The season year the correction belongs to. */
  season: seasonYearSchema,
  week: weekSchema,
  slot: slotSchema,
  /** The team the slot held before, `null` when it was empty. */
  fromTeamId: teamCodeSchema.nullable(),
  /** The team written, `null` when the correction cleared the slot. */
  toTeamId: teamCodeSchema.nullable(),
  reason: z.string().min(1),
  createdAt: instantSchema,
});

/** The result of a correction. */
export const correctPickResponseSchema = z.object({
  /** The corrected member's pick, as the board would show it. Absent when cleared. */
  pick: pickSchema.optional(),
  /** The corrected member's week score, so the caller need not refetch a board. */
  weekScore: weekScoreSchema,
  correction: correctionSchema,
});

/** The correction log for a season, newest first. */
export const correctionsResponseSchema = z.object({
  season: seasonSchema,
  corrections: z.array(correctionSchema),
});

/** The owner-facing view of one active or removed roster slot. */
export const adminMemberSchema = z.object({
  id: idSchema,
  displayName: displayNameSchema,
  role: memberRoleSchema,
  claimed: z.boolean(),
  isSelf: z.boolean(),
  joinedAt: instantSchema,
  removedAt: instantSchema.nullable(),
});

/** All roster slots, including removed slots that can be restored. */
export const adminMembersResponseSchema = z.object({
  members: z.array(adminMemberSchema),
});

/** Rename a league-local roster label. */
export const renameMemberRequestSchema = z.object({
  displayName: displayNameSchema,
});

/** The result of a member-management action. */
export const adminMemberResponseSchema = z.object({
  member: adminMemberSchema,
});

/** Rename the league — the "settings" surface for now, grown as needed. */
export const updateLeagueSettingsRequestSchema = z.object({
  name: leagueNameSchema,
});

/** A freshly allocated invite code; the old one stops working immediately. */
export const regenerateInviteResponseSchema = z.object({
  inviteCode: inviteCodeSchema,
});

export type CorrectPickRequest = z.infer<typeof correctPickRequestSchema>;
export type Correction = z.infer<typeof correctionSchema>;
export type CorrectPickResponse = z.infer<typeof correctPickResponseSchema>;
export type CorrectionsResponse = z.infer<typeof correctionsResponseSchema>;
export type AdminMember = z.infer<typeof adminMemberSchema>;
export type AdminMembersResponse = z.infer<typeof adminMembersResponseSchema>;
export type RenameMemberRequest = z.infer<typeof renameMemberRequestSchema>;
export type AdminMemberResponse = z.infer<typeof adminMemberResponseSchema>;
export type UpdateLeagueSettingsRequest = z.infer<typeof updateLeagueSettingsRequestSchema>;
export type RegenerateInviteResponse = z.infer<typeof regenerateInviteResponseSchema>;
