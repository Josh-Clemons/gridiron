import { describeRejection, type PickRejection } from '@gridiron/rules';
import { z } from 'zod';
import { instantSchema, slotSchema, teamCodeSchema, weekSchema } from './common';

/**
 * Why a pick was refused, on the wire.
 *
 * Mirrors `PickRejection` from `@gridiron/rules` field for field, except that
 * `kickoff` is an ISO string rather than a `Date`. The engine's own wording travels
 * with it as `message`, so a client that doesn't recognise a newly added code can
 * still show something true, and the rendered reason can't drift from the rule.
 */
export const pickRejectionSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('team_not_playing'),
    message: z.string(),
    teamId: teamCodeSchema,
    week: weekSchema,
  }),
  z.object({
    code: z.literal('game_locked'),
    message: z.string(),
    teamId: teamCodeSchema,
    kickoff: instantSchema,
  }),
  z.object({
    code: z.literal('slot_used_this_season'),
    message: z.string(),
    teamId: teamCodeSchema,
    slot: slotSchema,
    usedInWeek: weekSchema,
  }),
  z.object({
    code: z.literal('duplicate_team_this_week'),
    message: z.string(),
    teamId: teamCodeSchema,
    otherSlot: slotSchema,
  }),
  z.object({
    code: z.literal('same_game_as_other_pick'),
    message: z.string(),
    teamId: teamCodeSchema,
    otherSlot: slotSchema,
    otherTeamId: teamCodeSchema,
  }),
]);

export type PickRejectionWire = z.infer<typeof pickRejectionSchema>;

/** Serialise an engine rejection for transport. */
export function toWireRejection(rejection: PickRejection): PickRejectionWire {
  const message = describeRejection(rejection);
  return rejection.code === 'game_locked'
    ? { ...rejection, kickoff: rejection.kickoff.toISOString(), message }
    : { ...rejection, message };
}

/**
 * Every non-2xx response has this shape.
 *
 * `code` is for the client to branch on and `message` is for humans; nothing else is
 * ever returned on an error. In particular no stack traces, and no echo of the
 * submitted password — the old app logged `SignupRequest.toString()`, cleartext
 * password included.
 */
export const errorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'pick_rejected',
  'rate_limited',
  'internal',
]);

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Field-level detail for `bad_request`, keyed by dotted path. */
    fields: z.record(z.string(), z.string()).optional(),
    /** Present only on `pick_rejected`: every rule the pick broke, not just the first. */
    rejections: z.array(pickRejectionSchema).optional(),
  }),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
