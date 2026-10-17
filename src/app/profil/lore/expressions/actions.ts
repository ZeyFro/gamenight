"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteCommunityExpression, saveCommunityExpression } from "@/lib/community-expressions";
import { isCommunityExpressionsEnabled } from "@/lib/community-expressions-input";

const PATH = "/profil/lore/expressions";

export async function saveCommunityExpressionAction(formData: FormData): Promise<void> {
  if (!isCommunityExpressionsEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "communityExpressions")) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  const result = await saveCommunityExpression(user.id, formData.get("id"), formData.get("title"), formData.get("meaning"), communityId);
  if (result === "saved") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}

export async function deleteCommunityExpressionAction(formData: FormData): Promise<void> {
  if (!isCommunityExpressionsEnabled()) redirect("/profil/lore");
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "communityExpressions")) redirect(`${PATH}?result=rate`);
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 100) redirect(`${PATH}?result=invalid`);
  const result = await deleteCommunityExpression(user.id, formData.get("id"), communityId);
  if (result === "deleted") revalidatePath(PATH);
  redirect(`${PATH}?result=${result}`);
}
