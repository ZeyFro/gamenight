"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isGamePlatformsEnabled, isPlatformFamilyKey } from "@/lib/game-platforms";
import { checkLibraryBadgesForActiveCommunity } from "@/lib/badges";

/** Ajout rapide : le membre ajoute à SA bibliothèque un jeu déjà au catalogue (aucune écriture sur les tiers). */
export async function quickAddGameAction(formData: FormData) {
  if (!isGamePlatformsEnabled()) redirect("/bibliotheque");
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const family = String(formData.get("family") ?? "");
  const back = `/bibliotheque/plateformes${isPlatformFamilyKey(family) ? `?plateforme=${family}` : ""}`;
  const gameId = String(formData.get("gameId") ?? "");
  if (!gameId || gameId.length > 191) redirect(back);
  if (!checkRateLimit(user.id, "quickAddGame", { limit: 30, windowMs: 60_000 })) redirect(back);
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) redirect(back);
  await prisma.userGame.upsert({
    where: { userId_gameId: { userId: user.id, gameId } },
    update: { owned: true },
    create: { userId: user.id, gameId, owned: true, source: "MANUAL" },
  });
  await checkLibraryBadgesForActiveCommunity(user.id);
  revalidatePath("/bibliotheque");
  revalidatePath("/bibliotheque/plateformes");
  redirect(back);
}
