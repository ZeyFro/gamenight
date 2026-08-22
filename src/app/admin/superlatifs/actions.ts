"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

const DEFAULT_XP_REWARD = 20;

export async function addSuperlativeCategory(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const icon = String(formData.get("icon") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const xpRewardRaw = Number(formData.get("xpReward"));
  if (!icon || !name) return;

  const xpReward =
    Number.isFinite(xpRewardRaw) && xpRewardRaw > 0
      ? Math.round(xpRewardRaw)
      : DEFAULT_XP_REWARD;

  await prisma.superlativeCategory.create({
    data: {
      icon,
      name,
      description: description || null,
      xpReward,
      modifiedById: user.id,
    },
  });

  revalidatePath("/admin/superlatifs");
}

export async function updateSuperlativeCategory(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const icon = String(formData.get("icon") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const xpRewardRaw = Number(formData.get("xpReward"));
  if (!id || !icon || !name) return;

  const xpReward =
    Number.isFinite(xpRewardRaw) && xpRewardRaw > 0
      ? Math.round(xpRewardRaw)
      : DEFAULT_XP_REWARD;

  await prisma.superlativeCategory.update({
    where: { id },
    data: {
      icon,
      name,
      description: description || null,
      xpReward,
      modifiedById: user.id,
    },
  });

  revalidatePath("/admin/superlatifs");
}

export async function toggleSuperlativeCategoryActive(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const category = await prisma.superlativeCategory.findUnique({ where: { id } });
  if (!category) return;

  await prisma.superlativeCategory.update({
    where: { id },
    data: { active: !category.active, modifiedById: user.id },
  });
  revalidatePath("/admin/superlatifs");
}

export async function deleteSuperlativeCategory(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Cascade automatique via le schéma (onDelete: Cascade sur
  // SuperlativeVote/SuperlativeAward.category) : les votes et awards déjà
  // enregistrés pour cette catégorie disparaissent avec elle. Comme pour
  // `deleteGameStatType`, pas de garde-fou supplémentaire — désactiver
  // (`toggleSuperlativeCategoryActive`) est l'option non destructive si on
  // veut garder l'historique.
  await prisma.superlativeCategory.delete({ where: { id } });
  revalidatePath("/admin/superlatifs");
}
