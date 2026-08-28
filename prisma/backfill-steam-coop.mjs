// Backfill isCoop via Steam Store API (PR 32.6, Bloc A — suite du feedback
// prod sur PR #32/2.5 : le backfill IGDB seul laisse un filtre Coop
// incomplet, IGDB n'ayant pas les données de tous les jeux). Steam Store
// API (endpoint public, sans clé) couvre TOUT jeu importé depuis Steam par
// construction — source de vérité plus fiable pour cette bibliothèque-là.
//
// Priorité de source assumée (demandée : Steam Store > IGDB > défaut) :
// appliquée par SÉQUENCEMENT dans `npm run build` — ce script tourne APRÈS
// `backfill-coop.mjs` (IGDB). Un jeu déjà mis à jour par IGDB garde cette
// valeur si Steam Store échoue/n'a rien d'exploitable pour lui (ce script
// ne touche alors simplement pas `isCoop`) ; si Steam Store répond, sa
// valeur écrase celle d'IGDB. Pas de logique de comparaison croisée ici :
// la priorité vient entièrement de l'ordre d'exécution.
//
// `maxPlayers` n'est PAS mis à jour par ce script (contrairement à
// `backfill-coop.mjs`/IGDB, qui a de vrais chiffres via
// `multiplayer_modes.*max`) : les "categories" Steam Store sont des tags
// booléens (Coop/Multijoueur/…), pas des nombres de joueurs. Rien à
// synchroniser ici sans inventer un chiffre — documenté comme limite
// assumée plutôt que fabriqué.
//
// Node/ESM autonome, même philosophie que les autres scripts prisma/*.mjs :
// duplique volontairement la logique de `src/lib/steam-store.ts` (pas
// d'alias `@/...` exécutable par Node tel quel) — à GARDER EN SYNC.
//
// Portée : `source = STEAM` ET `playInfoManual = false` — jamais un jeu
// confirmé par un humain (formulaire manuel, bouton "Marquer comme coop",
// ou l'onglet "À vérifier" de PR 32.6/Bloc B). Wired dans `npm run build`,
// juste après `backfill-coop.mjs`. Repasse sur TOUS les jeux éligibles à
// chaque déploiement (pas de marqueur "déjà vérifié par Steam Store" — la
// demande excluait explicitement une migration Prisma pour ce Bloc) :
// même caractéristique héritée que `backfill-coop.mjs`, pas un problème
// nouveau introduit ici. Le temps de build grandit avec la taille de la
// biblio Steam du groupe (1,5s/jeu) — acceptable pour une biblio de
// groupe d'amis, mais à surveiller si elle devient très grande.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ~200 req/5 min documentées pour l'API Steam Store non authentifiée —
// 1,5s entre deux appels reste large en dessous (40 req/min max avec ce
// délai) pour rester safe, comme demandé.
const REQUEST_DELAY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COOP_CATEGORY_IDS = new Set([9, 24, 27, 38, 39, 48]);
const COOP_KEYWORDS = ["coop", "co-op", "coopératif", "écran partagé", "partagé"];

function deriveIsCoopFromCategories(categories) {
  return categories.some(
    (c) =>
      COOP_CATEGORY_IDS.has(c.id) ||
      COOP_KEYWORDS.some((kw) => c.description.toLowerCase().includes(kw))
  );
}

async function fetchSteamStoreDetails(steamAppId) {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=french`
  );
  if (res.status === 429) {
    const err = new Error("rate_limited");
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Steam Store (appid ${steamAppId}) a répondu ${res.status}`);
  }

  const body = await res.json();
  const entry = body[String(steamAppId)];
  if (!entry?.success || !entry.data) return null;

  const categories = entry.data.categories ?? [];
  return { categories, isCoop: deriveIsCoopFromCategories(categories) };
}

async function main() {
  const startedAt = Date.now();

  const games = await prisma.game.findMany({
    where: { source: "STEAM", playInfoManual: false, steamAppId: { not: null } },
    select: { id: true, name: true, steamAppId: true, isCoop: true },
  });

  if (games.length === 0) {
    console.log("[steam-store] Aucun jeu Steam éligible (déjà tous vérifiés manuellement, ou biblio vide).");
    return;
  }

  let updated = 0;
  let unchanged = 0;
  let noData = 0;
  let failed = 0;
  let rateLimitedStop = false;

  for (const game of games) {
    if (rateLimitedStop) break;

    try {
      const details = await fetchSteamStoreDetails(game.steamAppId);

      if (!details) {
        noData += 1;
        console.log(`[steam-store] ${game.name} → pas de fiche Steam Store exploitable.`);
      } else {
        const categoryNames = details.categories.map((c) => c.description).join(", ");
        console.log(
          `[steam-store] ${game.name} → categories: [${categoryNames}] → isCoop=${details.isCoop}`
        );

        if (details.isCoop !== game.isCoop) {
          await prisma.game.update({
            where: { id: game.id },
            data: { isCoop: details.isCoop },
          });
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
    } catch (error) {
      if (error.rateLimited) {
        rateLimitedStop = true;
        console.warn(
          `[steam-store] Rate limit Steam Store atteint après ${updated + unchanged + noData + failed} jeu(x) — arrêt anticipé, on garde ce qui a déjà été mis à jour (IGDB ou déjà en base) pour le reste.`
        );
        break;
      }
      failed += 1;
      console.error(`[steam-store] Échec pour ${game.name} (appid=${game.steamAppId})`, error);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[steam-store] Terminé en ${elapsedSeconds}s — ${updated} mis à jour, ${unchanged} déjà corrects, ${noData} sans donnée exploitable, ${failed} échec(s)${rateLimitedStop ? " (arrêt anticipé sur rate limit)" : ""} sur ${games.length} jeu(x) éligible(s).`
  );

  // Vue d'ensemble après backfill (IGDB + Steam Store combinés, pas de
  // détail par source : aucun champ ne trace QUELLE source a posé quelle
  // valeur, contrainte "aucune migration" du Bloc A — seul le résultat
  // final est mesurable ici, pas un historique par origine).
  const [coopAuto, coopManual, totalGames] = await Promise.all([
    prisma.game.count({ where: { isCoop: true, playInfoManual: false } }),
    prisma.game.count({ where: { isCoop: true, playInfoManual: true } }),
    prisma.game.count(),
  ]);
  console.log(
    `[steam-store] État global : ${coopAuto + coopManual}/${totalGames} jeu(x) marqués coop (${coopAuto} via backfill auto IGDB/Steam Store, ${coopManual} confirmés manuellement).`
  );
}

main()
  .catch((error) => {
    console.error("[steam-store] Échec :", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
