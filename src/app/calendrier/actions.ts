"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { checkSharedRateLimit } from "@/lib/shared-rate-limit";
import { parseDateOnly, toDateInputValue } from "@/lib/wallclock";

/** Écritures du calendrier : 30 par minute et par personne, compteur partagé entre les instances (audit : écritures sans limite). */
const COMMUNITY_DATE_WRITES_PER_MINUTE = 30;

/** Vrai si l'écriture est permise ; sinon l'action revient au calendrier avec `?error=rate` (message affiché par la page). */
async function allowWrite(userId: string): Promise<boolean> {
  return checkSharedRateLimit(userId, "communityDateWrite", { limit: COMMUNITY_DATE_WRITES_PER_MINUTE, windowMs: 60_000 });
}

function dateInput(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseDateOnly(value);
  return toDateInputValue(date) === value ? date : null;
}

function storedDate(date: Date, annual: boolean): Date {
  return annual ? new Date(Date.UTC(2000, date.getUTCMonth(), date.getUTCDate())) : date;
}

async function activeMembership(userId: string, communityId: string) {
  return prisma.membership.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { status: true, role: true, community: { select: { status: true } } },
  });
}

async function returnToCalendar(date?: Date, error?: "rate") {
  revalidatePath("/calendrier");
  const params = new URLSearchParams();
  if (date) params.set("date", toDateInputValue(date));
  if (error) params.set("error", error);
  const query = params.size ? `?${params}` : "";
  redirect(`/calendrier${query}`);
}

export async function saveCommunityBirthdayAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const communityId = await resolveActiveCommunityId(user.id);
  const date = dateInput(formData.get("date"));
  if (!communityId || !date) return;
  const membership = await activeMembership(user.id, communityId);
  if (membership?.status !== "ACTIVE" || membership.community.status !== "ACTIVE") return;
  if (!(await allowWrite(user.id))) await returnToCalendar(undefined, "rate");

  const scopedDb = await getActiveScopedPrisma(user.id);
  await scopedDb.communityDate.upsert({
    where: { communityId_memberId: { communityId, memberId: user.id } },
    create: { communityId, createdById: user.id, memberId: user.id, kind: "BIRTHDAY", date: storedDate(date, true), repeatsAnnually: true },
    update: { date: storedDate(date, true) },
  });
  // L’année de naissance ne doit pas apparaître dans l’URL après enregistrement.
  await returnToCalendar();
}

export async function createCommunityDateAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const communityId = await resolveActiveCommunityId(user.id);
  const date = dateInput(formData.get("date"));
  const title = String(formData.get("title") ?? "").trim();
  const annual = formData.get("annual") === "on";
  if (!communityId || !date || !title || title.length > 100) return;
  const membership = await activeMembership(user.id, communityId);
  if (membership?.status !== "ACTIVE" || membership.community.status !== "ACTIVE" || (membership.role !== "OWNER" && membership.role !== "ADMIN")) return;
  if (!(await allowWrite(user.id))) await returnToCalendar(date, "rate");

  const scopedDb = await getActiveScopedPrisma(user.id);
  await scopedDb.communityDate.create({
    data: { communityId, createdById: user.id, kind: "IMPORTANT", title, date: storedDate(date, annual), repeatsAnnually: annual },
  });
  await returnToCalendar(date);
}

export async function deleteCommunityDateAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) return;
  const membership = await activeMembership(user.id, communityId);
  if (membership?.status !== "ACTIVE" || membership.community.status !== "ACTIVE") return;
  const scopedDb = await getActiveScopedPrisma(user.id);
  const event = await scopedDb.communityDate.findUnique({ where: { id } });
  if (!event || event.communityId !== communityId) return;
  const ownsBirthday = event.kind === "BIRTHDAY" && event.memberId === user.id;
  const managesImportant = event.kind === "IMPORTANT" && (event.createdById === user.id || membership.role === "OWNER" || membership.role === "ADMIN");
  if (!ownsBirthday && !managesImportant) return;
  if (!(await allowWrite(user.id))) await returnToCalendar(event.date, "rate");
  await scopedDb.communityDate.delete({ where: { id } });
  await returnToCalendar(event.date);
}
