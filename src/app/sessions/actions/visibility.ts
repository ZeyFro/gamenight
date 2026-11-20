"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  applyToSession,
  decideSessionApplication,
  joinPublicSession,
  setSessionCoOrganizer,
  setSessionVisibility,
  withdrawApplication,
} from "@/lib/session-applications";

/**
 * Visibilité des soirées (flag `SESSION_VISIBILITY_ENABLED`). Chaque action relit
 * l'état en base : le navigateur ne fournit que des identifiants. Éteint, toutes
 * ces actions sont des no-op sans effet. Aucun appel Discord : voir
 * `src/lib/session-applications.ts` (file de synchronisation du fil privé).
 */

export async function joinPublicSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "joinPublicSession")) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  const result = await joinPublicSession(user.id, sessionId);
  revalidatePath("/sessions");
  if (result.ok) redirect(`/sessions/${sessionId}`);
}

export async function applyToSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "applyToSession")) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  await applyToSession(user.id, sessionId, String(formData.get("message") ?? ""));
  revalidatePath("/sessions");
}

export async function withdrawSessionApplicationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "withdrawSessionApplication")) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  await withdrawApplication(user.id, sessionId);
  revalidatePath("/sessions");
}

export async function decideSessionApplicationAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "decideSessionApplication")) return;
  const applicationId = String(formData.get("applicationId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const decision = String(formData.get("decision") ?? "") === "ACCEPT" ? "ACCEPT" : "DECLINE";
  if (!applicationId) return;
  await decideSessionApplication(user.id, applicationId, decision);
  revalidatePath(`/sessions/${sessionId}/invites`);
}

export async function setSessionCoOrganizerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setSessionCoOrganizer")) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  const raw = String(formData.get("coOrganizerId") ?? "").trim();
  if (!sessionId) return;
  await setSessionCoOrganizer(user.id, sessionId, raw || null);
  revalidatePath(`/sessions/${sessionId}/invites`);
}

export async function setSessionVisibilityAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "setSessionVisibility")) return;
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  await setSessionVisibility(user.id, sessionId, formData.get("visibility"));
  revalidatePath(`/sessions/${sessionId}/invites`);
  revalidatePath("/sessions");
}
