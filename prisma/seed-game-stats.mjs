// Seed des stats + superlatifs par défaut pour 3-4 jeux populaires de la
// bibliothèque commune (chantier XP, Axe 3, PR 4/9). Node/ESM autonome,
// même philosophie que prisma/seed.mjs et prisma/backfill-xp.mjs (pas de
// ts-node/tsx en dépendance) — wired dans `npm run build`, donc doit
// rester silencieux et sûr à rejouer indéfiniment.
//
// IMPORTANT — ce script tourne contre la vraie base au déploiement, PAS
// pendant le développement de cette PR : ce sandbox n'a aucun accès à la
// base de prod pour "regarder la vraie bibliothèque commune" au sens
// littéral. La sélection des jeux est donc entièrement PILOTÉE PAR LES
// DONNÉES RÉELLES au moment du build, plutôt que devinée à l'avance :
// - Contenu tout fait (stats + superlatifs) pour 4 jeux couramment cités
//   par l'utilisateur (Lethal Company, Content Warning, Counter-Strike 2,
//   Apex Legends) — utilisé UNIQUEMENT si un jeu correspondant existe
//   réellement dans la bibliothèque commune (au moins un `UserGame.owned`).
// - S'il manque des jeux curés (moins de 4 trouvés), les places restantes
//   sont comblées par les jeux réellement les plus possédés du groupe,
//   avec un petit set de stats génériques (score/morts) — mieux que rien
//   pour un jeu que je ne connais pas.
// - Idempotent PAR JEU : un jeu déjà configuré (au moins une
//   `GameStatType`) est laissé tel quel, jamais écrasé.
// - Imprime un récapitulatif à chaque run (jeux sélectionnés, popularité,
//   origine du contenu) — visible dans les logs de build Vercel, pour
//   vérifier que la sélection colle à la vraie bibliothèque commune,
//   même logique que le récapitulatif du backfill XP.

import { PrismaClient } from "@prisma/client";

const CURATED_GAMES = [
  {
    matchNames: ["lethal company"],
    stats: [
      {
        key: "morts",
        label: "Morts",
        type: "INT",
        higherIsBetter: false,
        superlatives: [{ name: "🐛 Bouffé par le grouille", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "butin",
        label: "Butin récupéré (crédits)",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "💰 Le rat", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "temps_survie",
        label: "Temps de survie (secondes)",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "😱 First blood", rule: "MIN", xpReward: 20 }],
      },
    ],
  },
  {
    matchNames: ["content warning"],
    stats: [
      {
        key: "score_viral",
        label: "Score de viralité",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "🎬 Meilleur cameraman", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "cris",
        label: "Nombre de cris",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "😱 Le crieur", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "video_virale",
        label: "A obtenu une vidéo virale",
        type: "BOOL",
        higherIsBetter: true,
        superlatives: [{ name: "🌟 Star du web", rule: "TRUE_COUNT", xpReward: 20 }],
      },
    ],
  },
  {
    matchNames: ["counter-strike 2", "counter strike 2", "cs2", "cs 2"],
    stats: [
      {
        key: "mvps",
        label: "MVPs",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "🏆 MVP", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "assists",
        label: "Assists",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "💀 Baby-sitter", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "morts",
        label: "Morts",
        type: "INT",
        higherIsBetter: false,
        superlatives: [{ name: "🐔 Feeder", rule: "MAX", xpReward: 20 }],
      },
    ],
  },
  {
    matchNames: ["apex legends", "apex"],
    stats: [
      {
        key: "kills",
        label: "Éliminations",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "🎯 Killer", rule: "MAX", xpReward: 20 }],
      },
      {
        key: "degats",
        label: "Dégâts infligés",
        type: "INT",
        higherIsBetter: true,
        superlatives: [{ name: "💥 Dégâts", rule: "MAX", xpReward: 20 }],
      },
    ],
  },
];

// Filet de sécurité pour un jeu populaire mais inconnu de moi — 2 stats
// universelles plutôt que rien.
const GENERIC_STATS = [
  {
    key: "score",
    label: "Score",
    type: "INT",
    higherIsBetter: true,
    superlatives: [{ name: "🏆 MVP de la soirée", rule: "MAX", xpReward: 20 }],
  },
  {
    key: "morts",
    label: "Morts",
    type: "INT",
    higherIsBetter: false,
    superlatives: [{ name: "💀 Le boulet", rule: "MAX", xpReward: 20 }],
  },
];

const MAX_SEEDED_GAMES = 4;

const prisma = new PrismaClient();

function normalize(name) {
  return name.toLowerCase().trim();
}

function matchesCurated(game, curated) {
  const n = normalize(game.name);
  return curated.matchNames.some((m) => n.includes(m) || m.includes(n));
}

async function seedGameStats(game, statsTemplate) {
  const existing = await prisma.gameStatType.count({ where: { gameId: game.id } });
  if (existing > 0) {
    console.log(`  déjà configuré (${existing} stat(s)) — rien à faire.`);
    return;
  }

  for (const stat of statsTemplate) {
    await prisma.gameStatType.create({
      data: {
        gameId: game.id,
        key: stat.key,
        label: stat.label,
        type: stat.type,
        higherIsBetter: stat.higherIsBetter,
        superlatives: { create: stat.superlatives },
      },
    });
  }

  const superlativeCount = statsTemplate.reduce(
    (n, s) => n + s.superlatives.length,
    0
  );
  console.log(
    `  ${statsTemplate.length} stat(s) + ${superlativeCount} superlatif(s) créés.`
  );
}

async function main() {
  const games = await prisma.game.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { userGames: { where: { owned: true } } } },
    },
  });

  const owned = games
    .map((g) => ({ id: g.id, name: g.name, ownerCount: g._count.userGames }))
    .filter((g) => g.ownerCount > 0)
    .sort((a, b) => b.ownerCount - a.ownerCount);

  if (owned.length === 0) {
    console.log(
      "[seed-game-stats] Aucun jeu dans la bibliothèque commune pour l'instant — seed reporté au prochain build."
    );
    return;
  }

  const usedIds = new Set();
  const selected = [];

  for (const curated of CURATED_GAMES) {
    const match = owned.find((g) => !usedIds.has(g.id) && matchesCurated(g, curated));
    if (!match) continue;
    usedIds.add(match.id);
    selected.push({ game: match, stats: curated.stats, source: "sur-mesure" });
  }

  for (const game of owned) {
    if (selected.length >= MAX_SEEDED_GAMES) break;
    if (usedIds.has(game.id)) continue;
    usedIds.add(game.id);
    selected.push({ game, stats: GENERIC_STATS, source: "générique" });
  }

  console.log(
    `\n=== Seed stats & superlatifs — ${selected.length} jeu(x) sélectionné(s) sur ${owned.length} possédé(s) ===`
  );
  for (const { game, stats, source } of selected) {
    console.log(
      `- ${game.name} (${game.ownerCount} possesseur(s) — contenu ${source})`
    );
    await seedGameStats(game, stats);
  }
  console.log("=== Fin ===\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
