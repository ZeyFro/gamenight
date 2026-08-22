"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StatType, SuperlativeRule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

const STAT_TYPES: StatType[] = ["INT", "FLOAT", "BOOL"];
const SUPERLATIVE_RULES: SuperlativeRule[] = ["MAX", "MIN", "TRUE_COUNT"];

function parseXpReward(formData: FormData): number {
  const raw = Number(formData.get("xpReward") ?? 20);
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 20;
}

export async function addGameStatType(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const gameId = String(formData.get("gameId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("type") ?? "") as StatType;
  const higherIsBetter = formData.get("higherIsBetter") === "on";
  if (!gameId || !key || !label || !STAT_TYPES.includes(type)) return;

  try {
    await prisma.gameStatType.create({
      data: { gameId, key, label, type, higherIsBetter, modifiedById: user.id },
    });
  } catch {
    // Contrainte unique (gameId, key) : clé déjà utilisée pour ce jeu, on ignore.
  }

  revalidatePath(`/admin/jeux-stats/${gameId}`);
}

export async function updateGameStatType(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("type") ?? "") as StatType;
  const higherIsBetter = formData.get("higherIsBetter") === "on";
  if (!id || !label || !STAT_TYPES.includes(type)) return;

  await prisma.gameStatType.update({
    where: { id },
    data: { label, type, higherIsBetter, modifiedById: user.id },
  });

  revalidatePath(`/admin/jeux-stats/${gameId}`);
}

export async function deleteGameStatType(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  if (!id) return;

  // Cascade automatique via le schéma (onDelete: Cascade sur
  // Superlative.gameStatType) : ses superlatifs disparaissent avec elle.
  await prisma.gameStatType.delete({ where: { id } });
  revalidatePath(`/admin/jeux-stats/${gameId}`);
}

export async function addSuperlative(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const gameId = String(formData.get("gameId") ?? "");
  const gameStatTypeId = String(formData.get("gameStatTypeId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const rule = String(formData.get("rule") ?? "") as SuperlativeRule;
  if (!gameStatTypeId || !name || !SUPERLATIVE_RULES.includes(rule)) return;

  await prisma.superlative.create({
    data: {
      gameStatTypeId,
      name,
      rule,
      xpReward: parseXpReward(formData),
      modifiedById: user.id,
    },
  });

  revalidatePath(`/admin/jeux-stats/${gameId}`);
}

export async function updateSuperlative(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const rule = String(formData.get("rule") ?? "") as SuperlativeRule;
  if (!id || !name || !SUPERLATIVE_RULES.includes(rule)) return;

  await prisma.superlative.update({
    where: { id },
    data: { name, rule, xpReward: parseXpReward(formData), modifiedById: user.id },
  });

  revalidatePath(`/admin/jeux-stats/${gameId}`);
}

export async function deleteSuperlative(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const id = String(formData.get("id") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  if (!id) return;

  await prisma.superlative.delete({ where: { id } });
  revalidatePath(`/admin/jeux-stats/${gameId}`);
}
