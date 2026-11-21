"use server";

import { notFound, redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAccountDeletionConfirmed, isAccountDeletionEnabled } from "@/lib/account-deletion-flag";
import { AccountBlobUnavailableError, deleteAccount } from "@/lib/account-deletion";

/**
 * Suppression de son propre compte (ACCOUNT_DELETION_ENABLED, docs/SUPPRESSION_COMPTE.md). Refus CÔTÉ SERVEUR flag
 * éteint (404). L'identifiant supprimé est TOUJOURS celui de la session : aucun champ du formulaire ne le désigne.
 * Confirmation forte : le pseudo exact ou « SUPPRIMER ». Aucune notification Discord.
 */
export async function deleteMyAccountAction(formData: FormData): Promise<void> {
  if (!isAccountDeletionEnabled()) notFound();
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "deleteMyAccount", { limit: 3, windowMs: 60_000 })) redirect("/profil/compte?erreur=rate_limited");
  if (!isAccountDeletionConfirmed(String(formData.get("confirmation") ?? ""), user.discordName)) redirect("/profil/compte?erreur=confirmation");

  let result: Awaited<ReturnType<typeof deleteAccount>>;
  try {
    result = await deleteAccount(user.id);
  } catch (error) {
    if (error instanceof AccountBlobUnavailableError) redirect("/profil/compte?erreur=stockage");
    throw error;
  }
  if (result.status === "refused") redirect("/profil/compte?erreur=proprietaire");
  if (result.status === "not_found") redirect("/");
  // « supprimé » ou « déjà supprimé » : la session ne désigne plus personne, on la ferme et on revient à l'accueil.
  await signOut({ redirectTo: "/?compte=supprime" });
}
