// Backfill isCoop/maxPlayers depuis IGDB (PR 32, 2.5/4 — Bug 2 remonté en
// prod : "le filtre Coop ne remonte que 3 jeux"). Root cause : l'import
// Steam pose `isCoop=false`/`maxPlayers=null` par défaut (Steam ne fournit
// pas cette info), donc la quasi-totalité des jeux Steam d'une biblio
// paraissaient "pas coop" même quand ils le sont réellement.
//
// Node/ESM autonome, même philosophie que les autres scripts prisma/*.mjs
// (pas de ts-node/tsx en dépendance) : duplique volontairement la logique
// de dérivation `isCoop`/`maxPlayersFromModes` de src/lib/igdb.ts et
// src/lib/game-details.ts (`computePlayInfoFromIgdb`) — à GARDER EN SYNC
// si la formule change.
//
// Portée : uniquement les jeux avec un cache IGDB déjà en base
// (`igdbDetails != null`, donc un `igdbId` connu) ET jamais confirmés par
// un humain (`playInfoManual: false`) — un jeu ajouté/édité manuellement
// via /bibliotheque/ajouter ou le panneau d'édition n'est jamais touché
// ici, ni un jeu marqué "coop"/"pas coop" via le bouton "Marquer comme
// coop" (PR 32, Bug 2C). Les jeux SANS cache IGDB (jamais visités sur leur
// fiche) sont couverts par l'enrichissement à la demande (Bug 2B,
// déclenché côté page quand le filtre Coop est actif), pas ici — cette
// portée réduite évite de faire un appel IGDB par jeu de toute la biblio à
// chaque build.
//
// Wired dans `npm run build`, juste après `backfill-xp.mjs` : idempotent
// (ne réécrit que ce qui change réellement), sûr à rejouer à chaque
// déploiement. Dégrade proprement sans IGDB_CLIENT_ID/SECRET configurées
// (avertissement, script sauté, build jamais cassé — même philosophie que
// DEEPL_API_KEY/DISCORD_WEBHOOK_URL absentes).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Petite pause entre deux appels IGDB — courtoisie envers le rate limit
// (plan gratuit IGDB/Twitch), pas une vraie contrainte mesurée ici (pas
// d'accès réseau depuis ce sandbox pour calibrer plus finement).
const REQUEST_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getIgdbToken(clientId, clientSecret) {
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Twitch OAuth (token IGDB) a répondu ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchMultiplayerModes(igdbId, clientId, token) {
  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: `where id = ${igdbId}; fields multiplayer_modes.onlinecoop,multiplayer_modes.offlinecoop,multiplayer_modes.lancoop,multiplayer_modes.campaigncoop,multiplayer_modes.offlinemax,multiplayer_modes.onlinemax,multiplayer_modes.offlinecoopmax,multiplayer_modes.onlinecoopmax; limit 1;`,
  });
  if (!res.ok) {
    throw new Error(`IGDB (jeu #${igdbId}) a répondu ${res.status}`);
  }
  const [game] = await res.json();
  return game?.multiplayer_modes ?? [];
}

function derivePlayInfo(modes) {
  const isCoop = modes.some(
    (m) => m.onlinecoop || m.offlinecoop || m.lancoop || m.campaigncoop
  );
  const maxCandidates = modes
    .flatMap((m) => [m.offlinemax, m.onlinemax, m.offlinecoopmax, m.onlinecoopmax])
    .filter((n) => typeof n === "number" && n > 0);
  const maxPlayersFromModes = maxCandidates.length > 0 ? Math.max(...maxCandidates) : null;
  return { isCoop, maxPlayersFromModes };
}

async function main() {
  const clientId = process.env.IGDB_CLIENT_ID?.trim();
  const clientSecret = process.env.IGDB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    console.warn(
      "[backfill-coop] IGDB_CLIENT_ID/IGDB_CLIENT_SECRET non configurées — backfill sauté."
    );
    return;
  }

  const games = await prisma.game.findMany({
    where: { igdbDetails: { not: null }, playInfoManual: false, igdbId: { not: null } },
    select: { id: true, igdbId: true, isCoop: true, maxPlayers: true },
  });

  if (games.length === 0) {
    console.log("[backfill-coop] Aucun jeu éligible (cache IGDB + pas de correction manuelle).");
    return;
  }

  let token;
  try {
    token = await getIgdbToken(clientId, clientSecret);
  } catch (error) {
    console.error("[backfill-coop] Échec d'authentification IGDB — backfill sauté.", error);
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const game of games) {
    try {
      const modes = await fetchMultiplayerModes(game.igdbId, clientId, token);
      const { isCoop, maxPlayersFromModes } = derivePlayInfo(modes);
      const maxPlayers = game.maxPlayers ?? maxPlayersFromModes;

      if (isCoop !== game.isCoop || maxPlayers !== game.maxPlayers) {
        await prisma.game.update({
          where: { id: game.id },
          data: { isCoop, maxPlayers },
        });
        updated += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[backfill-coop] Échec pour le jeu ${game.id} (igdbId=${game.igdbId})`,
        error
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-coop] ${updated}/${games.length} jeu(x) mis à jour${failed > 0 ? `, ${failed} échec(s)` : ""}.`
  );
}

main()
  .catch((error) => {
    console.error("[backfill-coop] Échec :", error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
