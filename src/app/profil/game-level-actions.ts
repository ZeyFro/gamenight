"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { removeUserGameLevel, setUserGameLevel } from "@/lib/game-levels";
import { gameLevelRemovalSchema, gameLevelSchema, isGameLevelsEnabled } from "@/lib/game-levels-rules";

function done(result: string): never {
  revalidatePath("/profil/parametres");
  revalidatePath("/potes", "layout");
  redirect(`/profil/parametres?niveaux=${result}`);
}

/** Déclare ou modifie son propre niveau : l'identité vient de la session, jamais du formulaire. */
export async function setGameLevelAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!isGameLevelsEnabled()) done("indisponible");
  if (!checkRateLimit(user.id, "setGameLevel")) done("rate_limited");
  const parsed = gameLevelSchema.safeParse({ gameId: formData.get("gameId"), level: formData.get("level") });
  if (!parsed.success) done("invalide");
  done(await setUserGameLevel(user.id, parsed.data.gameId, parsed.data.level));
}

export async function removeGameLevelAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!isGameLevelsEnabled()) done("indisponible");
  if (!checkRateLimit(user.id, "removeGameLevel")) done("rate_limited");
  const parsed = gameLevelRemovalSchema.safeParse({ gameId: formData.get("gameId") });
  if (!parsed.success) done("invalide");
  done(await removeUserGameLevel(user.id, parsed.data.gameId));
}
