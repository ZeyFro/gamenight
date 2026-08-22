// Seed des 6 superlatifs génériques par défaut (PR 5/9, version light du
// vote de superlatifs entre potes). Node/ESM autonome, même philosophie
// que prisma/seed.mjs et prisma/seed-game-stats.mjs — wired dans `npm run
// build`, doit rester silencieux et sûr à rejouer indéfiniment.
//
// Idempotent PAR NOM : un superlatif déjà en base avec ce nom exact n'est
// jamais recréé ni écrasé (l'utilisateur a pu le renommer/modifier son XP
// depuis /admin/superlatifs, on ne veut pas revenir dessus à chaque
// build). Base toute neuve sans utilisateur encore connecté : le script
// log un avertissement et NE FAIT RIEN, sans faire échouer le build — se
// rattrape tout seul au prochain déploiement.

import { PrismaClient } from "@prisma/client";

const DEFAULT_CATEGORIES = [
  { icon: "🏆", name: "MVP de la soirée", description: "Le meilleur, toutes catégories confondues.", xpReward: 30 },
  { icon: "💀", name: "Le plus mort / Le nul", description: "Celui qui est mort (ou a perdu) le plus de fois.", xpReward: 15 },
  { icon: "😂", name: "Le plus drôle", description: "Celui qui a le plus fait marrer la table.", xpReward: 15 },
  { icon: "🐢", name: "Le plus lent / Le boomer", description: "Celui qui a mis le plus de temps à comprendre le jeu.", xpReward: 10 },
  { icon: "🔥", name: "Le sweaty", description: "Celui qui a pris ça beaucoup trop au sérieux.", xpReward: 20 },
  { icon: "👻", name: "Le fantôme", description: "Le plus absent / afk de la soirée.", xpReward: 10 },
];

const prisma = new PrismaClient();

async function main() {
  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) {
    console.warn(
      "[seed-superlatives] Aucun utilisateur en base pour l'instant — seed reporté au prochain build."
    );
    return;
  }

  console.log("\n=== Seed superlatifs ===");
  let created = 0;
  for (const category of DEFAULT_CATEGORIES) {
    const existing = await prisma.superlativeCategory.findFirst({
      where: { name: category.name },
    });
    if (existing) {
      console.log(`- ${category.name} : déjà en base — rien à faire.`);
      continue;
    }

    await prisma.superlativeCategory.create({
      data: { ...category, modifiedById: author.id },
    });
    created += 1;
    console.log(`- ${category.name} : créé (+${category.xpReward} XP).`);
  }
  console.log(`=== ${created} superlatif(s) créé(s) sur ${DEFAULT_CATEGORIES.length} ===\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
