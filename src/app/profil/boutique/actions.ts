"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { buyShopItem, equipShopItem, type CosmeticKind } from "@/lib/xp-shop";

export async function buyShopItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "buyShopItem")) return;
  const communityId = await writeCommunityIdForUser(user.id);
  if (!communityId) redirect("/profil/boutique?status=no_community");

  const status = await buyShopItem(user.id, communityId, String(formData.get("itemId") ?? ""));
  revalidatePath("/");
  revalidatePath("/profil");
  revalidatePath("/profil/boutique");
  redirect(`/profil/boutique?status=${status}`);
}

export async function equipShopItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "equipShopItem")) return;
  const communityId = await writeCommunityIdForUser(user.id);
  if (!communityId) redirect("/profil/boutique?status=no_community");

  const kind = String(formData.get("kind") ?? "");
  if (!(kind === "TITLE" || kind === "FRAME" || kind === "COLOR")) {
    redirect("/profil/boutique?status=invalid");
  }
  const status = await equipShopItem(
    user.id,
    communityId,
    kind as CosmeticKind,
    String(formData.get("itemId") ?? "") || null
  );
  revalidatePath("/");
  revalidatePath("/profil");
  revalidatePath("/profil/boutique");
  redirect(`/profil/boutique?status=${status}`);
}
