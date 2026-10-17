"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { creationKey } from "@/lib/creation-intent";
import { saveCommunityHighlight, deleteCommunityHighlight } from "@/lib/community-highlights";

async function mutate(formData: FormData, remove: boolean) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const path = "/profil/lore/musee";
  if (!checkRateLimit(user.id, "communityHighlights")) redirect(`${path}?error=rate`);
  const id = formData.get("id");
  const communityId = formData.get("communityId");
  if (typeof communityId !== "string" || !communityId || communityId.length > 128) redirect(`${path}?error=invalid`);
  if (id !== null && (typeof id !== "string" || !id || id.length > 128)) redirect(`${path}?error=invalid`);
  let key: string | undefined;
  try { key = creationKey(formData.get("creationKey"), !id && !remove); }
  catch { redirect(`${path}?error=invalid`); }
  const saved = remove
    ? !!id && await deleteCommunityHighlight(user.id, id, communityId)
    : await saveCommunityHighlight(user.id, id, {
      kind: formData.get("kind"), title: formData.get("title"),
      description: formData.get("description"), mediaUrl: formData.get("mediaUrl"),
    }, { creationKey: key, communityId });
  if (!saved) redirect(`${path}?error=invalid`);
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function saveHighlightAction(formData: FormData): Promise<void> { await mutate(formData, false); }
export async function deleteHighlightAction(formData: FormData): Promise<void> { await mutate(formData, true); }
