import { z } from "zod";

export const PLAYER_CLASSIFIED_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const playerClassifiedSchema = z.object({
  gameId: z.string().trim().min(1).max(191),
  message: z.string().trim().min(1).max(240),
});

export function playerClassifiedExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PLAYER_CLASSIFIED_LIFETIME_MS);
}
