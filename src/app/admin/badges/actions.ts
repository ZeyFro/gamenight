"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BadgeCategory, BadgeRarity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { CRITERIA_TYPES } from "@/lib/badge-rarity";

const CATEGORIES: BadgeCategory[] = [
  "PARTICIPATION",
  "ENGAGEMENT",
  "BIBLIOTHEQUE",
  "VOTE",
  "SUPERLATIFS",
];
const RARITIES: BadgeRarity[] = ["COMMON", "RARE", "EPIC", "LEGENDARY"];

function parseCriteria(formData: FormData): { type: string; count: number } | null {
  const type = String(formData.get("criteriaType") ?? "");
  const count = Number(formData.get("criteriaCount"));
  if (!CRITERIA_TYPES.includes(type) || !Number.isFinite(count) || count < 1) return null;
  return { type, count: Math.round(count) };
}

function parseXpReward(formData: FormData): number | null {
  const raw = String(formData.get("xpReward") ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export async function addBadge(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "") as BadgeCategory;
  const rarity = String(formData.get("rarity") ?? "") as BadgeRarity;
  const criteria = parseCriteria(formData);
  if (
    !name ||
    !icon ||
    !description ||
    !CATEGORIES.includes(category) ||
    !RARITIES.includes(rarity) ||
    !criteria
  ) {
    return;
  }

  try {
    await prisma.badge.create({
      data: {
        name,
        icon,
        description,
        category,
        rarity,
        criteria,
        xpReward: parseXpReward(formData),
        modifiedById: user.id,
      },
    });
  } catch {
    // Contrainte unique sur `name` : nom déjà pris, on ignore (même
    // discrétion que addGameStatType pour sa contrainte unique).
  }

  revalidatePath("/admin");
}

export async function updateBadge(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "") as BadgeCategory;
  const rarity = String(formData.get("rarity") ?? "") as BadgeRarity;
  const criteria = parseCriteria(formData);
  if (
    !id ||
    !name ||
    !icon ||
    !description ||
    !CATEGORIES.includes(category) ||
    !RARITIES.includes(rarity) ||
    !criteria
  ) {
    return;
  }

  await prisma.badge.update({
    where: { id },
    data: {
      name,
      icon,
      description,
      category,
      rarity,
      criteria,
      xpReward: parseXpReward(formData),
      modifiedById: user.id,
    },
  });

  revalidatePath("/admin");
}

export async function toggleBadgeActive(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const badge = await prisma.badge.findUnique({ where: { id } });
  if (!badge) return;

  await prisma.badge.update({
    where: { id },
    data: { active: !badge.active, modifiedById: user.id },
  });
  revalidatePath("/admin");
}

export async function deleteBadge(formData: FormData) {
  const user = await requireAdmin();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Catalogue partagé : archiver préserve les attributions historiques de tous les serveurs.
  await prisma.badge.update({ where: { id }, data: { active: false, modifiedById: user.id } });
  revalidatePath("/admin");
}
