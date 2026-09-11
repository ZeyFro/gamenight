import { prisma } from "@/lib/prisma";

/**
 * Seed des 6 superlatifs génériques par défaut (version light du vote de
 * superlatifs entre potes). Convertie depuis `prisma/seed-superlatives.mjs`
 * (PR "build ne fait plus que compiler") — port mécanique, contenu propre
 * au seed.
 *
 * Idempotent PAR NOM : un superlatif déjà en base avec ce nom exact n'est
 * jamais recréé ni écrasé (l'utilisateur a pu le renommer/modifier son XP
 * depuis `/admin/superlatifs`).
 */

const DEFAULT_CATEGORIES = [
  { icon: "🏆", name: "MVP de la soirée", description: "Le meilleur, toutes catégories confondues.", xpReward: 30 },
  { icon: "💀", name: "Le plus mort / Le nul", description: "Celui qui est mort (ou a perdu) le plus de fois.", xpReward: 15 },
  { icon: "😂", name: "Le plus drôle", description: "Celui qui a le plus fait marrer la table.", xpReward: 15 },
  { icon: "🐢", name: "Le plus lent / Le boomer", description: "Celui qui a mis le plus de temps à comprendre le jeu.", xpReward: 10 },
  { icon: "🔥", name: "Le sweaty", description: "Celui qui a pris ça beaucoup trop au sérieux.", xpReward: 20 },
  { icon: "👻", name: "Le fantôme", description: "Le plus absent / afk de la soirée.", xpReward: 10 },
];

export async function seedSuperlatives(): Promise<void> {
  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) return; // aucun user pour l'instant — reporté au prochain passage

  for (const category of DEFAULT_CATEGORIES) {
    const existing = await prisma.superlativeCategory.findFirst({
      where: { name: category.name },
    });
    if (existing) continue;

    await prisma.superlativeCategory.create({
      data: { ...category, modifiedById: author.id },
    });
  }
}
