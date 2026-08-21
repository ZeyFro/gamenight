"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateOnly } from "@/lib/wallclock";

export async function addWeeklySlot(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  if (Number.isNaN(dayOfWeek) || !startTime || !endTime) return;

  await prisma.weeklyAvailability.create({
    data: { userId: user.id, dayOfWeek, startTime, endTime },
  });

  revalidatePath("/disponibilites");
}

export async function removeWeeklySlot(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.weeklyAvailability.deleteMany({
    where: { id, userId: user.id },
  });
  revalidatePath("/disponibilites");
}

export async function upsertOverride(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dateStr = String(formData.get("date") ?? "");
  if (!dateStr) return;
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
}

export async function removeOverride(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.availabilityOverride.deleteMany({
    where: { id, userId: user.id },
  });
  revalidatePath("/disponibilites");
}
