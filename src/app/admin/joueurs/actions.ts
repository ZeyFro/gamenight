"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { applyXpAdjustment, normalizeAdjustmentReason, parseXpValue } from "@/lib/admin-xp";
import type { ActionFormResult } from "@/components/ActionForm";

/**
 * Correction manuelle de l'XP d'un joueur (onglet « Joueurs » de /admin). Chaque
 * appel revérifie l'accès admin et ne fait jamais confiance au formulaire : la
 * communauté visée est TOUJOURS la communauté actuelle de l'admin, relue côté
 * serveur (la valeur envoyée par le formulaire ne sert qu'à détecter un
 * changement de serveur entre l'affichage et la confirmation).
 */
export async function adjustPlayerXpAction(formData: FormData): Promise<ActionFormResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "unauthorized" };
  if (!checkRateLimit(admin.id, "adjustPlayerXp")) return { ok: false, error: RATE_LIMIT_ERROR_KEY };

  const userId = formData.get("userId");
  const submittedCommunityId = formData.get("communityId");
  const newXp = parseXpValue(formData.get("newXp"));
  const expectedOldXp = parseXpValue(formData.get("expectedOldXp"));
  const reason = normalizeAdjustmentReason(formData.get("reason"));
  if (typeof userId !== "string" || userId === "" || newXp === null || expectedOldXp === null || !reason.ok) {
    return { ok: false, error: "invalid" };
  }

  const communityId = await writeCommunityIdForUser(admin.id);
  if (communityId === null) return { ok: false, error: "not_member" };
  if (submittedCommunityId !== communityId) {
    revalidatePath("/admin");
    return { ok: false, error: "community_changed" };
  }

  const result = await applyXpAdjustment({
    adminId: admin.id,
    adminName: admin.discordName,
    communityId,
    userId,
    newXp,
    expectedOldXp,
    reason: reason.reason,
  });
  // Rafraîchit la fiche dans tous les cas : après un échec « stale » ou « unchanged »,
  // l'admin doit revoir le solde réel avant de confirmer à nouveau.
  revalidatePath("/admin");
  if (!result.ok) return { ok: false, error: result.reason };
  return { ok: true };
}
