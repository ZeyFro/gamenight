"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateOnly } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { personalCommunityIds } from "@/lib/community-stats";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  idSchema,
  overrideDateRefSchema,
  overrideSchema,
  VALIDATION_ERROR_KEY,
  weeklySlotSchema,
} from "@/lib/validations";

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

  const input = weeklySlotSchema.safeParse({
    dayOfWeek: Number(formData.get("dayOfWeek")),
    startTime: String(formData.get("startTime") ?? ""),
    endTime: String(formData.get("endTime") ?? ""),
  });
  // Bug corrigé (chantier "Validation entrées serveur") : cette branche
  // renvoyait `{ ok: true }` sur une entrée invalide — `ActionForm`
  // affichait alors le toast de succès "Dispo sauvegardée" alors que rien
  // n'avait été enregistré. Retourne désormais une vraie erreur.
  if (!input.success) return { ok: false, error: VALIDATION_ERROR_KEY };
  const { dayOfWeek, startTime, endTime } = input.data;

  // Compté avant l'insertion : "1ère fois" au sens de l'Axe 1 XP =
  // premier créneau hebdo jamais renseigné par ce user.
  const hadSlotsBefore =
    (await prisma.weeklyAvailability.count({ where: { userId: user.id } })) > 0;

  await prisma.weeklyAvailability.create({
    data: { userId: user.id, dayOfWeek, startTime, endTime },
  });

  if (!hadSlotsBefore) {
    // Action personnelle : créditée dans chaque communauté du membre (registre d'XP par communauté).
    for (const communityId of await personalCommunityIds(user.id)) {
      await awardXp(user.id, "AVAILABILITY_FIRST", user.id, XP_AMOUNTS.AVAILABILITY_FIRST, { communityId });
    }
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

  const input = idSchema.safeParse(formData.get("id"));
  if (!input.success) return;
  const id = input.data;

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

  const input = overrideSchema.safeParse({
    date: String(formData.get("date") ?? ""),
    available: formData.get("available") === "true",
    startTime: String(formData.get("startTime") ?? "").trim(),
    endTime: String(formData.get("endTime") ?? "").trim(),
  });
  // Même bug corrigé qu'`addWeeklySlot` ci-dessus : une date vide renvoyait
  // `{ ok: true }` sans rien enregistrer.
  if (!input.success) return { ok: false, error: VALIDATION_ERROR_KEY };
  const { available } = input.data;
  const date = parseDateOnly(input.data.date);
  const startTime = input.data.startTime || null;
  const endTime = input.data.endTime || null;

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

  const input = idSchema.safeParse(formData.get("id"));
  if (!input.success) return;
  const id = input.data;

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

  const input = overrideDateRefSchema.safeParse({
    date: String(formData.get("date") ?? ""),
  });
  // Même bug corrigé que ci-dessus : une date vide renvoyait `{ ok: true }`.
  if (!input.success) return { ok: false, error: VALIDATION_ERROR_KEY };
  const date = parseDateOnly(input.data.date);

  await prisma.availabilityOverride.deleteMany({
    where: { userId: user.id, date },
  });
  revalidatePath("/disponibilites");
  revalidatePath("/calendrier");
  return { ok: true };
}
