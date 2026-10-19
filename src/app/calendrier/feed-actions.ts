"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { createCalendarFeedToken, isCalendarFeedEnabled, revokeCalendarFeedToken } from "@/lib/calendar-feed";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

export type CalendarFeedState = { path?: string; communityName?: string; message?: string; error?: string };

export async function manageCalendarFeedAction(_previous: CalendarFeedState, formData: FormData): Promise<CalendarFeedState> {
  if (!isCalendarFeedEnabled()) return { error: "L’abonnement calendrier est désactivé." };
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return { error: "Connecte-toi pour gérer ton abonnement." };
  const mode = formData.get("mode");
  if (mode !== "create" && mode !== "revoke") return { error: "Action invalide." };
  if (!checkRateLimit(user.id, "calendarFeed")) return { error: RATE_LIMIT_MESSAGE };

  if (mode === "revoke") {
    if (!await revokeCalendarFeedToken(user.id)) return { error: "Choisis un serveur dont tu es membre actif." };
    revalidatePath("/calendrier");
    return { message: "Le lien de ce serveur est révoqué. Ton application calendrier peut conserver ses anciennes données en cache." };
  }
  const result = await createCalendarFeedToken(user.id);
  if (!result) return { error: "Choisis un serveur dont tu es membre actif." };
  revalidatePath("/calendrier");
  return { path: `/api/calendrier/feed/${result.token}`, communityName: result.communityName, message: "Nouveau lien créé. L’ancien lien de ce serveur ne fonctionne plus." };
}
