import { prisma } from "@/lib/prisma";
import type { StatType, SuperlativeRule } from "@prisma/client";

/**
 * Seed des stats + superlatifs par défaut pour 3-4 jeux populaires de la
 * bibliothèque commune. Convertie depuis `prisma/seed-game-stats.mjs` (PR
 * "build ne fait plus que compiler") — port mécanique, `CURATED_GAMES`
 * n'est dupliqué nulle part ailleurs dans le repo.
 *
 * Sélection PILOTÉE PAR LES DONNÉES RÉELLES au moment de l'exécution :
 * - Contenu tout fait (stats + superlatifs) pour 4 jeux couramment cités
 *   (Lethal Company, Content Warning, Counter-Strike 2, Apex Legends) —
 *   utilisé UNIQUEMENT si un jeu correspondant existe réellement dans la
 *   bibliothèque commune (au moins un `UserGame.owned`).
 * - S'il manque des jeux curés, les places restantes sont comblées par
 *   les jeux réellement les plus possédés du groupe, avec un set de stats
 *   génériques (score/morts).
 * - Idempotent PAR JEU : un jeu déjà configuré (au moins une
 *   `GameStatType`) est laissé tel quel, jamais écrasé.
 */

interface StatTemplate {
  key: string;
  label: string;
  type: StatType;
  higherIsBetter: boolean;
  superlatives: { name: string; rule: SuperlativeRule; xpReward: number }[];
}

const CURATED_GAMES: { matchNames: string[]; stats: StatTemplate[] }[] = [
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

// Filet de sécurité pour un jeu populaire mais non curé — 2 stats
// universelles plutôt que rien.
const GENERIC_STATS: StatTemplate[] = [
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

function normalize(name: string): string {
  return name.toLowerCase().trim();
}

function matchesCurated(
  game: { name: string },
  curated: { matchNames: string[] }
): boolean {
  const n = normalize(game.name);
  return curated.matchNames.some((m) => n.includes(m) || m.includes(n));
}

async function seedStatsForGame(
  gameId: string,
  statsTemplate: StatTemplate[],
  authorId: string
): Promise<void> {
  const existing = await prisma.gameStatType.count({ where: { gameId } });
  if (existing > 0) return;

  for (const stat of statsTemplate) {
    await prisma.gameStatType.create({
      data: {
        gameId,
        key: stat.key,
        label: stat.label,
        type: stat.type,
        higherIsBetter: stat.higherIsBetter,
        modifiedById: authorId,
        superlatives: {
          create: stat.superlatives.map((s) => ({ ...s, modifiedById: authorId })),
        },
      },
    });
  }
}

export async function seedGameStats(): Promise<void> {
  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) return; // aucun user pour l'instant — reporté au prochain passage

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

  if (owned.length === 0) return;

  const usedIds = new Set<string>();
  const selected: { gameId: string; stats: StatTemplate[] }[] = [];

  for (const curated of CURATED_GAMES) {
    const match = owned.find((g) => !usedIds.has(g.id) && matchesCurated(g, curated));
    if (!match) continue;
    usedIds.add(match.id);
    selected.push({ gameId: match.id, stats: curated.stats });
  }

  for (const game of owned) {
    if (selected.length >= MAX_SEEDED_GAMES) break;
    if (usedIds.has(game.id)) continue;
    usedIds.add(game.id);
    selected.push({ gameId: game.id, stats: GENERIC_STATS });
  }

  for (const { gameId, stats } of selected) {
    await seedStatsForGame(gameId, stats, author.id);
  }
}
