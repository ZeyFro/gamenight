// Auto-désactivation des MessageTemplate déjà en base avec une variable
// invalide pour l'une de leurs catégories (Fix 4A/4C, PR 30 — bug "texte à
// trous" remonté en prod : un message coché à la fois REMINDER_24H et
// SESSION_CREATED avec {jeu} passait l'ancienne validation "union" alors
// que SESSION_CREATED seul ne supporte pas {jeu}, envoyé tel quel sans
// valeur à la création d'une session).
//
// Node/ESM autonome, même philosophie que prisma/seed.mjs et
// prisma/backfill-xp.mjs (pas de ts-node/tsx en dépendance) : ce script
// duplique volontairement `CATEGORY_VARIABLES` de src/lib/message-templates.ts
// plutôt que de l'importer (alias `@/...` non exécutable tel quel par
// Node). À GARDER EN SYNC si les catégories/variables changent.
//
// Wired dans `npm run build`, juste après le seed des messages : idempotent
// (une ligne déjà désactivée n'est jamais retouchée), donc sûr à rejouer à
// chaque déploiement. Désactivation SILENCIEUSE côté utilisateur final
// (aucune notif Discord, `active: false` retire juste le message du tirage
// aléatoire de `pickMessageTemplate`) — juste loggé ici pour être visible
// dans les logs de build Vercel, à charge d'un admin de corriger ou
// supprimer le message via /admin?tab=messages une fois prévenu.

import { PrismaClient } from "@prisma/client";

const CATEGORY_VARIABLES = {
  SESSION_CREATED: ["heure", "date", "createur"],
  SESSION_MODIFIED: ["heure", "date", "createur", "ancienne_heure", "ancienne_date"],
  REMINDER_24H: ["pote", "jeu", "heure"],
  REMINDER_2H: ["pote", "jeu", "heure"],
  LEVEL_UP: ["user", "ancien_niveau", "nouveau_niveau", "titre", "rang"],
  SESSION_AWARDS: ["gagnants"],
  BADGE_UNLOCKED: ["user", "badge_name", "badge_icon", "rarity"],
};

function findInvalidCategoryVariables(text, categories) {
  const usedVars = Array.from(new Set(Array.from(text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1])));
  const invalid = [];
  for (const category of categories) {
    for (const variable of usedVars) {
      if (!(CATEGORY_VARIABLES[category] ?? []).includes(variable)) {
        invalid.push({ category, variable });
      }
    }
  }
  return invalid;
}

const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.messageTemplate.findMany({
    where: { active: true },
  });

  let disabledCount = 0;

  for (const template of templates) {
    const invalid = findInvalidCategoryVariables(template.text, template.categories);
    if (invalid.length === 0) continue;

    await prisma.messageTemplate.update({
      where: { id: template.id },
      data: { active: false },
    });
    disabledCount += 1;

    const details = invalid
      .map(({ category, variable }) => `{${variable}} invalide pour ${category}`)
      .join(", ");
    console.warn(
      `[fix-invalid-templates] Désactivé "${template.text}" (id=${template.id}) — ${details}.`
    );
  }

  if (disabledCount === 0) {
    console.log("[fix-invalid-templates] Aucun message invalide trouvé.");
  } else {
    console.log(`[fix-invalid-templates] ${disabledCount} message(s) désactivé(s).`);
  }
}

main()
  .catch((error) => {
    console.error("[fix-invalid-templates] Échec :", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
