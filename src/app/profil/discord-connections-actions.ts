"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { DISCORD_CONNECTIONS_SCOPES, isDiscordConnectionsScopeEnabled } from "@/lib/discord-connections";

/**
 * Consentement explicite et OPTIONNEL : sans la case cochée, aucune demande de scope n'est faite.
 * La reconnexion Discord repasse par TOUTES les gardes de `signIn` (connexion fermée S0 incluse).
 */
export async function requestDiscordConnectionsAction(formData: FormData) {
  if (!isDiscordConnectionsScopeEnabled()) redirect("/profil/parametres");
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "requestDiscordConnections")) redirect("/profil/parametres?connexions=rate_limited");
  if (formData.get("consent") !== "on") redirect("/profil/parametres?connexions=consentement");
  await signIn("discord", { redirectTo: "/profil/parametres?connexions=ok" }, { scope: DISCORD_CONNECTIONS_SCOPES });
}

/** Efface les suggestions du membre connecté (aucun identifiant du profil n'est touché). */
export async function clearConnectionSuggestionsAction() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "clearConnectionSuggestions")) redirect("/profil/parametres?connexions=rate_limited");
  await prisma.platformConnectionSuggestion.deleteMany({ where: { userId: user.id } });
  revalidatePath("/profil/parametres");
  redirect("/profil/parametres?connexions=effacees");
}
