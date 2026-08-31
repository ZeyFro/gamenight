// Diversifie la couleur perso des comptes qui n'ont jamais fait de choix
// explicite (PR 4/4, sous-PR 1 — chantier calendrier). La migration pose
// `color = '#8b5cf6'` (violet, l'accent existant) en valeur par défaut
// pour TOUS les comptes existants d'un coup (une seule valeur possible
// dans un `ADD COLUMN ... DEFAULT`) — ce script réassigne ensuite une
// couleur différente à chacun depuis une palette de 10 couleurs vives et
// distinctes, par ordre d'ancienneté du compte (`createdAt` croissant) :
// palette[0] au compte le plus ancien, palette[1] au suivant, etc.
//
// Le compte le plus ancien (typiquement celui qui a initialisé le
// groupe) reçoit donc violet (palette[0], l'accent existant) — cohérent
// avec le défaut de la colonne, aucun cas particulier à coder.
//
// Distribution garantie sans doublon tant que le groupe compte au plus
// 10 membres (taille de la palette) : au-delà, l'assignation reboucle
// (palette[index % 10]) — limite assumée, un groupe de potes dépassant
// 10 personnes actives est hors du cas d'usage visé par cette app.
//
// Rejoué à chaque build (comme backfill-xp.mjs, backfill-badges.mjs…) :
// purement en base, aucun appel réseau, coût négligeable. Ne touche
// jamais un compte avec `colorCustomized = true` (choix humain via
// `/profil/parametres`) — même garde-fou que `Game.playInfoManual`
// (PR 32). Déterministe (palette[index % taille], trié par `createdAt`)
// : un compte garde la même couleur d'un déploiement à l'autre tant que
// personne ne la change à la main, aucun jeu de chaises musicales visuel
// au fil des rejeux.
//
// Duplique volontairement `USER_COLOR_PALETTE` de `src/lib/user-color.ts`
// (script Node/ESM autonome, pas d'accès aux alias `@/...`) — à GARDER EN
// SYNC si la palette change.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const USER_COLOR_PALETTE = [
  "#8b5cf6", // Violet
  "#ef4444", // Rouge
  "#f97316", // Orange
  "#eab308", // Jaune
  "#22c55e", // Vert
  "#06b6d4", // Cyan
  "#3b82f6", // Bleu
  "#ec4899", // Rose
  "#f8fafc", // Blanc
  "#64748b", // Anthracite
];

async function main() {
  const users = await prisma.user.findMany({
    where: { colorCustomized: false },
    select: { id: true, discordName: true, color: true },
    orderBy: { createdAt: "asc" },
  });

  if (users.length === 0) {
    console.log("[backfill-user-colors] Aucun compte à couleur par défaut.");
    return;
  }

  let updated = 0;

  for (const [index, user] of users.entries()) {
    const color = USER_COLOR_PALETTE[index % USER_COLOR_PALETTE.length];
    if (color !== user.color) {
      await prisma.user.update({ where: { id: user.id }, data: { color } });
      updated += 1;
    }
    console.log(
      `[backfill-user-colors] ${user.discordName} (compte #${index + 1}) → ${color}`
    );
  }

  console.log(
    `[backfill-user-colors] ${updated}/${users.length} compte(s) mis à jour (palette de ${USER_COLOR_PALETTE.length} couleurs).`
  );
}

main()
  .catch((error) => {
    console.error("[backfill-user-colors] Échec :", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
