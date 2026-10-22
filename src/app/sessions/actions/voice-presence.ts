"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { grantSessionVoiceConsent, withdrawSessionVoiceConsent } from "@/lib/session-voice-presence";

function sessionPath(formData: FormData) {
  const value = formData.get("sessionId");
  if (typeof value !== "string" || !value.trim() || value.length > 128) redirect("/sessions");
  return `/sessions/${encodeURIComponent(value)}`;
}

export async function grantVoicePresenceConsentAction(formData: FormData): Promise<void> {
  const path = sessionPath(formData);
  if (process.env.VOICE_PRESENCE_ENABLED !== "true") redirect(`${path}?voice=disabled`);
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const granted = await grantSessionVoiceConsent(formData.get("sessionId") as string, user.id);
  if (!granted) redirect(`${path}?voice=unavailable`);
  revalidatePath(path);
  redirect(`${path}?voice=consented`);
}

export async function withdrawVoicePresenceConsentAction(formData: FormData): Promise<void> {
  const path = sessionPath(formData);
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const withdrawn = await withdrawSessionVoiceConsent(formData.get("sessionId") as string, user.id);
  if (!withdrawn) redirect(`${path}?voice=unavailable`);
  revalidatePath(path);
  redirect(`${path}?voice=withdrawn`);
}
