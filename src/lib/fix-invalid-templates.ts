import { prisma } from "@/lib/prisma";
import { findInvalidCategoryVariables } from "@/lib/message-templates";

/**
 * Auto-désactivation des `MessageTemplate` déjà en base avec une variable
 * invalide pour l'une de leurs catégories (Fix 4A/4C, PR 30 — bug "texte à
 * trous" remonté en prod). Convertie depuis `prisma/fix-invalid-templates.mjs`
 * (PR "build ne fait plus que compiler") : réutilise directement
 * `findInvalidCategoryVariables` (déjà utilisée par le formulaire admin et
 * les server actions) au lieu de la dupliquer — l'ancienne version Node/ESM
 * autonome ne pouvait pas résoudre l'alias `@/...`.
 *
 * Idempotent (une ligne déjà désactivée n'est jamais retouchée).
 * Désactivation SILENCIEUSE côté utilisateur final (aucune notif Discord,
 * `active: false` retire juste le message du tirage aléatoire de
 * `pickMessageTemplate`) — à charge d'un admin de corriger/supprimer le
 * message via `/admin?tab=messages` une fois prévenu (logs).
 */
export async function fixInvalidMessageTemplates(): Promise<void> {
  const templates = await prisma.messageTemplate.findMany({ where: { active: true } });

  for (const template of templates) {
    const invalid = findInvalidCategoryVariables(template.text, template.categories);
    if (invalid.length === 0) continue;

    await prisma.messageTemplate.update({
      where: { id: template.id },
      data: { active: false },
    });
  }
}
