"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MessageCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { ALL_MESSAGE_CATEGORIES, variablesForCategories } from "@/lib/message-templates";

function parseCategories(formData: FormData): MessageCategory[] {
  return ALL_MESSAGE_CATEGORIES.filter(
    (category) => formData.get(`category-${category}`) === "on"
  );
}

export async function addMessageTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;

  const categories = parseCategories(formData);

  await prisma.messageTemplate.create({
    data: {
      text,
      categories,
      variables: variablesForCategories(categories),
      createdById: user.id,
    },
  });

  revalidatePath("/admin/messages");
}

export async function updateMessageTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!id || !text) return;

  const categories = parseCategories(formData);

  await prisma.messageTemplate.update({
    where: { id },
    data: { text, categories, variables: variablesForCategories(categories) },
  });

  revalidatePath("/admin/messages");
}

export async function toggleMessageTemplateActive(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const template = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!template) return;

  await prisma.messageTemplate.update({
    where: { id },
    data: { active: !template.active },
  });
  revalidatePath("/admin/messages");
}

export async function deleteMessageTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.messageTemplate.delete({ where: { id } });
  revalidatePath("/admin/messages");
}
