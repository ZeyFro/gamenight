"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { changeSessionPreparation, preparationInput } from "@/lib/session-preparation";
import { logger } from "@/lib/logger";

export async function sessionPreparationAction(input: unknown): Promise<{ ok: boolean }> {
  const user = await getCurrentUser({ recordActivity: false });
  const parsed = preparationInput.safeParse(input);
  if (!user || !parsed.success || !checkRateLimit(user.id, "sessionPreparation", { limit: 30 })) return { ok: false };
  try {
    const ok = await changeSessionPreparation(user.id, parsed.data);
    if (ok) revalidatePath(`/sessions/${parsed.data.sessionId}`);
    return { ok };
  } catch (error) {
    logger.error("session-preparation", error, { userId: user.id, sessionId: parsed.data.sessionId });
    return { ok: false };
  }
}
