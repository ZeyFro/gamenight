"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { gamePlatformsSchema, isGamePlatformsEnabled } from "@/lib/game-platforms";

/** Plateformes et crossplay d'un jeu, déclarés par un membre qui possède ce jeu (même règle que les avertissements). */
export async function updateGamePlatformsAction(formData: FormData) {
  if (!isGamePlatformsEnabled()) redirect("/bibliotheque");
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const gameId = String(formData.get("gameId") ?? "");
  const back = `/jeux/${encodeURIComponent(gameId)}`;
  if (!checkRateLimit(user.id, "updateGamePlatforms")) redirect(`${back}?plateformes=rate_limited`);
  const parsed = gamePlatformsSchema.safeParse({
    gameId,
    platforms: formData.getAll("platforms"),
    crossplay: formData.get("crossplay") ?? "",
  });
  if (!parsed.success) redirect(`${back}?plateformes=invalide`);
  // L'autorisation fait partie de l'écriture : owned:false et tiers refusés.
  const result = await prisma.game.updateMany({
    where: { id: parsed.data.gameId, userGames: { some: { userId: user.id, owned: true } } },
    data: { platforms: parsed.data.platforms, crossplay: parsed.data.crossplay },
  });
  if (!result.count) redirect(`${back}?plateformes=acces`);
  revalidatePath(back);
  revalidatePath("/bibliotheque/plateformes");
  redirect(`${back}?plateformes=ok`);
}
