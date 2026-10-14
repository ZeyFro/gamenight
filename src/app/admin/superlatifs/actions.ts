"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

const DEFAULT_XP_REWARD = 20;

export async function addSuperlativeCategory(formData: FormData) {
  const user = await requireAdmin();
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
  const user = await requireAdmin();
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
  const user = await requireAdmin();
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
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Catalogue partagé : archiver préserve votes et récompenses historiques de tous les serveurs.
  await prisma.superlativeCategory.update({ where: { id }, data: { active: false, modifiedById: user.id } });
  revalidatePath("/admin/superlatifs");
}
