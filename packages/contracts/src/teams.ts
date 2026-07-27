import { z } from 'zod';
import { teamCodeSchema } from './common';

/**
 * A team's display identity.
 *
 * The rest of the API speaks bare codes (`KC`) — they're stable, they're what the
 * pool itself says out loud, and they keep the board payload small. This endpoint is
 * the one place the codes are expanded into names, fetched once and cached forever
 * so nothing else has to carry them.
 */
export const teamSchema = z.object({
  code: teamCodeSchema,
  name: z.string().min(1),
  shortName: z.string().min(1),
});

export const teamsResponseSchema = z.object({
  teams: z.array(teamSchema),
});

export type Team = z.infer<typeof teamSchema>;
export type TeamsResponse = z.infer<typeof teamsResponseSchema>;
