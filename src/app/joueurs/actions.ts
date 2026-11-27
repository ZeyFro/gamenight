"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { getPlayerClassifiedCommunityId, playerClassifiedExpiresAt, playerClassifiedSchema } from "@/lib/player-classifieds";
import { wallClockNow } from "@/lib/wallclock";
import { requireAdmin } from "@/lib/admin";
import { deletePlayerListing, relayNewPlayerListing } from "@/lib/player-listings";

export async function createPlayerClassifiedAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/joueurs?error=unavailable");
  if (!checkRateLimit(user.id, "createPlayerClassified")) redirect("/joueurs?error=rate_limited");

  const input = playerClassifiedSchema.safeParse({
    gameId: formData.get("gameId"),
    message: formData.get("message"),
    platform: formData.get("platform") ?? undefined,
    microphoneRequirement: formData.get("microphoneRequirement") ?? undefined,
    partyType: formData.get("partyType") ?? undefined,
    startsDate: formData.get("startsDate") ?? undefined,
    startsTime: formData.get("startsTime") ?? undefined,
    durationMinutes: formData.get("durationMinutes"),
  });
  if (!input.success) redirect("/joueurs?error=invalid");
  const scopedDb = await getScopedPrisma(user.id);
  const game = await scopedDb.game.findUnique({ where: { id: input.data.gameId }, select: { id: true } });
  if (!game) redirect("/joueurs?error=invalid");

  const createdAt = wallClockNow();
  if (input.data.startsAt && input.data.startsAt <= createdAt) redirect("/joueurs?error=invalid");
  const data: Prisma.PlayerClassifiedUncheckedCreateInput = {
    communityId,
    gameId: game.id,
    createdById: user.id,
    message: input.data.message,
    createdAt,
    expiresAt: playerClassifiedExpiresAt(createdAt),
    platform: input.data.platform,
    microphoneRequirement: input.data.microphoneRequirement,
    partyType: input.data.partyType,
    startsAt: input.data.startsAt,
    durationMinutes: input.data.durationMinutes,
  };
  const created = await scopedDb.playerClassified.create({
    data,
    select: { id: true },
  });
  // Relais forum (D3) : mêmes garde-fous que la commande Discord (profil masqué jamais relayé, ping opt-in plafonné, aucune écriture directe).
  await relayNewPlayerListing({ listingId: created.id, communityId, userId: user.id, message: input.data.message });
  revalidatePath("/joueurs");
  redirect("/joueurs");
}

export async function deletePlayerClassifiedAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) redirect("/joueurs?error=unavailable");
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) redirect("/joueurs?error=invalid");

  // Même service que la commande Discord : le fil forum de l'annonce est fermé (événement portant le fil) AVANT la suppression de la ligne.
  const outcome = await deletePlayerListing({
    userId: user.id,
    communityId,
    listingId: parsed.data,
    isAdmin: Boolean(await requireAdmin()),
  });
  if (outcome === "rate_limited") redirect("/joueurs?error=rate_limited");
  if (outcome === "forum_unavailable") redirect("/joueurs?error=forum_unavailable");
  if (outcome === "not_owner" || outcome === "missing") redirect("/joueurs?error=forbidden");
  revalidatePath("/joueurs");
}
