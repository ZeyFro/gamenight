import { z } from "zod";

export const communityTeamSchema = z.object({
  gameId: z.string().trim().min(1).max(191),
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(1000),
  platform: z.string().trim().min(1).max(40),
  maxMembers: z.coerce.number().int().min(2).max(20),
});
