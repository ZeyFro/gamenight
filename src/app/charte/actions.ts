"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { findActiveMembership } from "@/lib/community-access";
import { prisma } from "@/lib/prisma";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";
import { parseFairPlayCharter } from "@/lib/fair-play-charter";

export async function saveFairPlayCharterAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) return;
  const membership = await findActiveMembership(user.id, communityId);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) return;
  // Écriture sans limite jusqu'ici (audit) : 10 enregistrements par minute et par personne, compteur partagé ; refus sans message,
  // comme les autres refus de cette action (la page ne porte pas de paramètre d'erreur).
  if (!(await checkSharedRateLimit(user.id, "fairPlayCharter", { limit: 10, windowMs: 60_000 }))) return;
  const rawCharter = formData.get("charter");
  if (typeof rawCharter !== "string") return;
  const charter = parseFairPlayCharter(rawCharter);
  if (rawCharter.trim() && charter === null) return;

  const { count } = await prisma.community.updateMany({
    where: {
      id: communityId,
      status: "ACTIVE",
      memberships: { some: { userId: user.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } } },
    },
    data: { fairPlayCharter: charter },
  });
  if (count === 1) revalidatePath("/charte");
}
