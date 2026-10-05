"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import {
  SERVEURS_PATH,
  isCommunityPickerEnabled,
  safeNextPath,
  setActiveCommunity,
} from "@/lib/community-picker";

/**
 * Choix du serveur actif (drapeau COMMUNITY_PICKER_ENABLED). Le serveur choisi
 * est revalidé en base (Membership ACTIVE, communauté ACTIVE) avant toute
 * écriture ; un identifiant étranger ou périmé ne change rien et renvoie sur
 * `/serveurs`. Le choix ne donne aucun accès : voir `community-access.ts`.
 */
export async function selectCommunityAction(formData: FormData): Promise<void> {
  if (!isCommunityPickerEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const communityId = formData.get("communityId");
  const next = formData.get("next");
  if (typeof communityId !== "string" || communityId === "") redirect(SERVEURS_PATH);
  if (!(await setActiveCommunity(user.id, communityId))) redirect(SERVEURS_PATH);

  revalidatePath("/", "layout");
  redirect(safeNextPath(typeof next === "string" ? next : null));
}
