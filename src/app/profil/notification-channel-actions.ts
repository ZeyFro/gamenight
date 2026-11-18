"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { isAvailableNotificationCategory } from "@/lib/notification-preferences";
import {
  isAvailableNotificationChannel,
  isCoveredNotificationChannel,
  setOwnNotificationChannelPreference,
} from "@/lib/notification-channel-preferences";

export async function updateNotificationChannelPreferenceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "updateNotificationChannelPreference")) {
    redirect("/profil/parametres?notifications=rate_limited");
  }

  const category = String(formData.get("category") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const enabledValue = String(formData.get("enabled") ?? "");
  if (!isAvailableNotificationCategory(category) || !isAvailableNotificationChannel(channel) ||
    !isCoveredNotificationChannel(category, channel) || !["true", "false"].includes(enabledValue)) {
    redirect("/profil/parametres?notifications=invalide");
  }

  try {
    await setOwnNotificationChannelPreference(user.id, category, channel, enabledValue === "true");
  } catch (error) {
    logger.error("notification-channel-preferences", error, { userId: user.id, category, channel });
    redirect("/profil/parametres?notifications=erreur");
  }

  revalidatePath("/profil/parametres");
  redirect("/profil/parametres?notifications=ok");
}
