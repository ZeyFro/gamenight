"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function addReminderTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;

  await prisma.reminderTemplate.create({
    data: { text, createdById: user.id },
  });

  revalidatePath("/admin/rappels");
}

export async function updateReminderTemplateText(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!id || !text) return;

  await prisma.reminderTemplate.update({ where: { id }, data: { text } });
  revalidatePath("/admin/rappels");
}

export async function toggleReminderTemplateActive(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const template = await prisma.reminderTemplate.findUnique({ where: { id } });
  if (!template) return;

  await prisma.reminderTemplate.update({
    where: { id },
    data: { active: !template.active },
  });
  revalidatePath("/admin/rappels");
}

export async function deleteReminderTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.reminderTemplate.delete({ where: { id } });
  revalidatePath("/admin/rappels");
}
