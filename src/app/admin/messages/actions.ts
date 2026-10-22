"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MessageCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import {
  ALL_MESSAGE_CATEGORIES,
  MAX_MESSAGE_TEXT_LENGTH,
  findInvalidCategoryVariables,
  variablesForCategories,
} from "@/lib/message-templates";

function parseCategories(formData: FormData): MessageCategory[] {
  return ALL_MESSAGE_CATEGORIES.filter(
    (category) => formData.get(`category-${category}`) === "on"
  );
}

export async function addMessageTemplate(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const text = String(formData.get("text") ?? "").trim();
  if (!text || text.length > MAX_MESSAGE_TEXT_LENGTH) return;

  const categories = parseCategories(formData);
  // Filet de sécurité serveur (Fix 4C) : le formulaire bloque déjà
  // l'envoi côté client (`MessageTemplateForm`), ce garde-fou ne devrait
  // donc jamais se déclencher en usage normal — il évite juste qu'un
  // contournement du formulaire (requête directe, vieux JS en cache…)
  // puisse quand même écrire un message "à trous" en base.
  if (findInvalidCategoryVariables(text, categories).length > 0) return;

  await prisma.messageTemplate.create({
    data: {
      text,
      categories,
      variables: variablesForCategories(categories),
      createdById: user.id,
      modifiedById: user.id,
    },
  });

  revalidatePath("/admin/messages");
}

export async function updateMessageTemplate(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!id || !text || text.length > MAX_MESSAGE_TEXT_LENGTH) return;

  const categories = parseCategories(formData);
  if (findInvalidCategoryVariables(text, categories).length > 0) return;

  await prisma.messageTemplate.update({
    where: { id },
    data: {
      text,
      categories,
      variables: variablesForCategories(categories),
      modifiedById: user.id,
    },
  });

  revalidatePath("/admin/messages");
}

export async function toggleMessageTemplateActive(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const template = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!template) return;

  await prisma.messageTemplate.update({
    where: { id },
    data: { active: !template.active, modifiedById: user.id },
  });
  revalidatePath("/admin/messages");
}

export async function deleteMessageTemplate(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.messageTemplate.delete({ where: { id } });
  revalidatePath("/admin/messages");
}
