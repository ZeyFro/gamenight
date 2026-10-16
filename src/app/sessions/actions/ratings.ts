"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { getSessionAccessRole } from "@/lib/session-access";
import { checkRateLimit } from "@/lib/rate-limit";

export async function rateSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !checkRateLimit(user.id, "rateSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const rating = Number(formData.get("rating"));
  if (!sessionId || !Number.isInteger(rating) || rating < 1 || rating > 5) return;
  if (!(await getSessionAccessRole(user.id, sessionId))) return;

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { status: true, communityId: true } });
  if (!session || session.status !== "DONE") return;

  await scopedDb.sessionRating.upsert({
    where: { sessionId_userId: { sessionId, userId: user.id } },
    create: { sessionId, userId: user.id, communityId: session.communityId, rating },
    update: { rating },
  });
  revalidatePath(`/sessions/${sessionId}`);
}
