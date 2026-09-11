import { prisma } from "@/lib/prisma";
import { USER_COLOR_PALETTE } from "@/lib/user-color";

/**
 * Diversifie la couleur perso des comptes qui n'ont jamais fait de choix
 * explicite. Convertie depuis `prisma/backfill-user-colors.mjs` (PR
 * "build ne fait plus que compiler") : importe directement
 * `USER_COLOR_PALETTE` de `@/lib/user-color` au lieu de la dupliquer —
 * l'ancienne version Node/ESM autonome ne pouvait pas résoudre l'alias
 * `@/...`.
 *
 * Distribution déterministe par ordre d'ancienneté du compte
 * (`palette[index % taille]`) — ne touche jamais un compte avec
 * `colorCustomized = true` (choix humain via `/profil/parametres`).
 * Purement en base, aucun appel réseau, coût négligeable.
 */
export async function backfillUserColors(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { colorCustomized: false },
    select: { id: true, color: true },
    orderBy: { createdAt: "asc" },
  });

  for (const [index, user] of users.entries()) {
    const color = USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length].hex;
    if (color !== user.color) {
      await prisma.user.update({ where: { id: user.id }, data: { color } });
    }
  }
}
