"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { changeSessionSeat, type SeatResult } from "@/lib/session-seats";
import { logger } from "@/lib/logger";

const schema = z.object({ sessionId: z.string().min(1).max(128), command: z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["join", "leave", "refresh"]) }),
  z.object({ kind: z.literal("capacity"), capacity: z.number().int().min(1).max(100) }),
]) });
export async function sessionSeatAction(input: unknown): Promise<SeatResult | { ok: false; error: "authentication" | "rate_limited" | "unavailable" }> {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return { ok: false, error: "authentication" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "capacity" };
  if (!checkRateLimit(user.id, "sessionSeat", { limit: 12 })) return { ok: false, error: "rate_limited" };
  try {
    const result = await changeSessionSeat(user.id, parsed.data.sessionId, parsed.data.command);
    if (result.ok) {
      revalidatePath(`/sessions/${parsed.data.sessionId}`);
      revalidatePath(`/sessions/${parsed.data.sessionId}/resultats`);
      revalidatePath("/sessions");
    }
    return result;
  } catch (error) {
    logger.error("session-seats", error, { userId: user.id, sessionId: parsed.data.sessionId });
    return { ok: false, error: "unavailable" };
  }
}
