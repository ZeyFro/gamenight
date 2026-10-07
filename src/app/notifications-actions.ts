"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Marque toutes les notifications de l'utilisateur courant comme lues —
 * appelée à l'ouverture du panneau (`NotificationBell`) et par le bouton
 * "Tout marquer comme lu". Garde silencieuse (pas de retour à afficher) :
 * même convention que les autres actions "toggle" du profil.
 */
export async function markAllNotificationsReadAction() {
  const user = await getCurrentUser();
  if (!user) return;
  if (!checkRateLimit(user.id, "markAllNotificationsRead")) return;

  const scopedDb = await getActiveScopedPrisma(user.id);
  await scopedDb.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });

  revalidatePath("/");
}
