"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateOnly } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";

/**
 * Toutes les actions ci-dessous sont invoquées via `<ActionForm>` — le
 * type de retour `{ ok, error? }` (au lieu du `void` d'origine, PR "Rate
 * limiting") permet à `ActionForm` de distinguer un rate limit atteint
 * d'une exécution normale et d'afficher le bon toast, plutôt que le toast
 * de succès générique dans tous les cas.
 */
export interface DispoActionResult {
  ok: boolean;
  error?: string;
}

export async function addWeeklySlot(formData: FormData): Promise<DispoActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "addWeeklySlot")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (Number.isNaN(dayOfWeek) || !startTime || !endTime) return { ok: true };

  // Compté avant l'insertion : "1ère fois" au sens de l'Axe 1 XP =
  // premier créneau hebdo jamais renseigné par ce user.
  const hadSlotsBefore =
    (await prisma.weeklyAvailability.count({ where: { userId: user.id } })) > 0;

  await prisma.weeklyAvailability.create({
    data: { userId: user.id, dayOfWeek, startTime, endTime },
  });

  if (!hadSlotsBefore) {
    await awardXp(
      user.id,
      "AVAILABILITY_FIRST",
      user.id,
      XP_AMOUNTS.AVAILABILITY_FIRST
    );
  }

  revalidatePath("/disponibilites");
  return { ok: true };
}

// `removeWeeklySlot` est invoquée depuis un `<form action=…>` brut (pas
// `ActionForm`) sur /disponibilites — reste `void`, garde-fou silencieux
// pour le rate limit comme ses autres conditions existantes (`!id`).
export async function removeWeeklySlot(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "removeWeeklySlot")) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.weeklyAvailability.deleteMany({
    where: { id, userId: user.id },
  });
  revalidatePath("/disponibilites");
}

export async function upsertOverride(formData: FormData): Promise<DispoActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "upsertOverride")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const dateStr = String(formData.get("date") ?? "");
  if (!dateStr) return { ok: true };
  const date = parseDateOnly(dateStr);

  const available = formData.get("available") === "true";
  const startTime = String(formData.get("startTime") ?? "").trim() || null;
  const endTime = String(formData.get("endTime") ?? "").trim() || null;

  await prisma.availabilityOverride.upsert({
    where: { userId_date: { userId: user.id, date } },
    update: { available, startTime, endTime },
    create: { userId: user.id, date, available, startTime, endTime },
  });

  revalidatePath("/disponibilites");
  revalidatePath("/calendrier");
  return { ok: true };
}

// Invoquée depuis un `<form action=…>` brut sur /disponibilites — même
// remarque que `removeWeeklySlot` ci-dessus, reste `void`.
export async function removeOverride(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "removeOverride")) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.availabilityOverride.deleteMany({
    where: { id, userId: user.id },
  });
  revalidatePath("/disponibilites");
  revalidatePath("/calendrier");
}

/**
 * Variante de `removeOverride` adressée par date plutôt que par id — le
 * calendrier (`/calendrier`, édition tactile) connaît la date éditée, pas
 * l'id opaque de la ligne en base. Même contrainte unique `(userId, date)`
 * que `upsertOverride`, même garde-fou d'appartenance.
 */
export async function removeOverrideForDate(
  formData: FormData
): Promise<DispoActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "removeOverrideForDate")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const dateStr = String(formData.get("date") ?? "");
  if (!dateStr) return { ok: true };
  const date = parseDateOnly(dateStr);

  await prisma.availabilityOverride.deleteMany({
    where: { userId: user.id, date },
  });
  revalidatePath("/disponibilites");
  revalidatePath("/calendrier");
  return { ok: true };
}
