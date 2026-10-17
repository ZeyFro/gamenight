"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteCommunityGameEpitaph, saveCommunityGameEpitaph } from "@/lib/community-game-graveyard";
import { isCommunityGameGraveyardEnabled } from "@/lib/community-game-graveyard-input";

const PATH = "/profil/lore/cimetiere";

export async function saveCommunityGameEpitaphAction(formData: FormData): Promise<void> {
  if (!isCommunityGameGraveyardEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "communityGameGraveyard")) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  const result = await saveCommunityGameEpitaph(user.id, formData.get("id"), formData.get("gameId"), formData.get("epitaph"), communityId);
  if (result === "saved") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}

export async function deleteCommunityGameEpitaphAction(formData: FormData): Promise<void> {
  if (!isCommunityGameGraveyardEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "communityGameGraveyard")) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  const result = await deleteCommunityGameEpitaph(user.id, formData.get("id"), communityId);
  if (result === "deleted") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}
