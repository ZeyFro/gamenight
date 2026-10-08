"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { withCommunityReadContext } from "@/lib/community-read-context";
import { loadSessionSlotSuggestions, type SlotSuggestionsResult } from "@/lib/session-slot-data";
import { checkRateLimit } from "@/lib/rate-limit";
import { wallClockNow } from "@/lib/wallclock";
import { logger } from "@/lib/logger";

const inputSchema = z.object({
  guestIds: z.array(z.string().min(1).max(128)).max(1000),
  durationMinutes: z.union([z.literal(60), z.literal(90), z.literal(120), z.literal(180)]),
});

export async function suggestSessionSlotsAction(input: unknown): Promise<SlotSuggestionsResult> {
  return withCommunityReadContext(async () => {
    const user = await getCurrentUser({ recordActivity: false });
    if (!user) return { ok: false, error: "authentication" };
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    if (!checkRateLimit(user.id, "suggestSessionSlots", { limit: 6 })) return { ok: false, error: "rate_limited" };
    try {
      return await loadSessionSlotSuggestions(user.id, parsed.data.guestIds, parsed.data.durationMinutes, wallClockNow());
    } catch (error) {
      logger.error("session-slot-suggestions", error, { userId: user.id });
      return { ok: false, error: "unavailable" };
    }
  });
}
