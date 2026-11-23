"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";
import { cancelFriendRequest, removeFriend, respondFriendRequest, sendFriendRequest } from "@/lib/friends";
import { FRIEND_REQUESTS_PER_DAY, isFriendsEnabled } from "@/lib/friends-rules";

/**
 * Actions « Potes = amis » (POTES_FRIENDS_ENABLED). L'utilisateur est toujours celui de la session : aucun identifiant
 * de demandeur n'est lu du formulaire, seulement la cible (ou la demande) concernée. Aucune notification.
 */
function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

/** Retour sur la page d'origine (liste ou fiche), jamais vers une adresse fournie par le formulaire. */
function backTo(formData: FormData): string {
  const poteId = field(formData, "returnPoteId");
  return poteId && /^[a-z0-9]+$/i.test(poteId) ? `/potes/${poteId}` : "/potes";
}

export async function sendFriendRequestAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const target = field(formData, "targetId");
  const back = backTo(formData);
  if (!isFriendsEnabled() || !target) redirect(back);
  if (!checkRateLimit(user.id, "friendRequest", { limit: 10, windowMs: 60_000 })) redirect(back);
  if (!(await checkSharedRateLimit(user.id, "friendRequestDaily", { limit: FRIEND_REQUESTS_PER_DAY, windowMs: 24 * 60 * 60_000 }))) redirect(back);
  await sendFriendRequest(user.id, target);
  revalidatePath("/potes");
  redirect(back);
}

export async function respondFriendRequestAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const id = field(formData, "requestId");
  const decision = formData.get("decision");
  if (!isFriendsEnabled() || !id || (decision !== "accept" && decision !== "decline")) redirect("/potes");
  if (!checkRateLimit(user.id, "friendRespond", { limit: 30, windowMs: 60_000 })) redirect("/potes");
  await respondFriendRequest(user.id, id, decision === "accept");
  revalidatePath("/potes");
  redirect("/potes");
}

export async function cancelFriendRequestAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const id = field(formData, "requestId");
  if (!isFriendsEnabled() || !id) redirect("/potes");
  if (!checkRateLimit(user.id, "friendCancel", { limit: 30, windowMs: 60_000 })) redirect("/potes");
  await cancelFriendRequest(user.id, id);
  revalidatePath("/potes");
  redirect("/potes");
}

export async function removeFriendAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const other = field(formData, "friendId");
  if (!isFriendsEnabled() || !other) redirect("/potes");
  if (!checkRateLimit(user.id, "friendRemove", { limit: 10, windowMs: 60_000 })) redirect("/potes");
  await removeFriend(user.id, other);
  revalidatePath("/potes");
  redirect("/potes");
}
