"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { isNotificationCenterEnabled, setOwnGamePingOptIn } from "@/lib/game-ping-optin";

export async function markNotificationReadAction(formData: FormData) {
  if (!isNotificationCenterEnabled()) return;
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "markNotificationRead")) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const scopedDb = await getActiveScopedPrisma(user.id);
  await scopedDb.notification.updateMany({ where: { id, userId: user.id }, data: { read: true } });
  revalidatePath("/notifications");
}

export async function toggleGamePingAction(formData: FormData) {
  if (!isNotificationCenterEnabled()) redirect("/");
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleGamePing")) redirect("/notifications?ping=rate_limited");
  const gameId = String(formData.get("gameId") ?? "");
  const enabled = formData.get("enabled");
  if (!gameId || (enabled !== "true" && enabled !== "false")) redirect("/notifications?ping=invalide");
  const result = await setOwnGamePingOptIn(user.id, gameId, enabled === "true");
  revalidatePath("/notifications");
  redirect(`/notifications?ping=${result}`);
}
