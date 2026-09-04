import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkLibraryBadges } from "@/lib/badges";
import { checkWishlistPurchases } from "@/lib/wishlist";
import { wallClockNow } from "@/lib/wallclock";

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const STEAM_ID_REGEX = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export function getSteamAuthUrl(returnTo: string): string {
  const realm = new URL(returnTo).origin;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

/**
 * Vérifie la réponse OpenID 2.0 de Steam en la re-postant avec
 * `check_authentication` (obligatoire : Steam ne signe pas la réponse d'une
 * façon vérifiable côté client, il faut lui redemander de confirmer).
 * Retourne le SteamID64 si la signature est valide, sinon null.
 */
export async function verifySteamOpenId(
  query: URLSearchParams
): Promise<string | null> {
  const params = new URLSearchParams(query);
  params.set("openid.mode", "check_authentication");

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const text = await res.text();
  if (!text.includes("is_valid:true")) return null;

  const claimedId = query.get("openid.claimed_id");
  if (!claimedId) return null;
  const match = STEAM_ID_REGEX.exec(claimedId);
  return match ? match[1] : null;
}

export interface SteamOwnedGame {
  appid: number;
  name: string;
  // Sprint 4 (FEATURE 4, dernière activité Steam) — timestamp Unix
  // (secondes) renvoyé par Steam pour chaque jeu possédé, non documenté
  // officiellement mais stable en pratique (déjà exploité par de
  // nombreux clients tiers) : évite un second appel API dédié
  // (`GetRecentlyPlayedGames` ne donne qu'un temps de jeu sur 2 semaines,
  // pas un vrai timestamp de dernière session) — `getOwnedGames` (déjà
  // appelée par le cron `steam-library-sync` existant) suffit.
  rtime_last_played?: number;
}

export type GetOwnedGamesResult =
  | { ok: true; games: SteamOwnedGame[] }
  | { ok: false; reason: "private" };

/**
 * Steam renvoie `{ response: {} }` (pas de `game_count`) quand le profil ou
 * les détails de jeu sont privés, contre `{ response: { game_count, games } }`
 * (potentiellement `games: []` pour une biblio publique mais vide) sinon.
 * On distingue les deux cas sur la présence de `game_count`.
 */
export async function getOwnedGames(
  steamId64: string
): Promise<GetOwnedGamesResult> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) throw new Error("STEAM_API_KEY n'est pas configurée.");

  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId64);
  url.searchParams.set("include_appinfo", "true");
  // Fix bug remonté (Family/free games manquants) : sans ce paramètre,
  // Steam omet parfois les jeux free-to-play joués et certains titres
  // partagés — l'inclure est strictement plus permissif, jamais moins
  // (aucun jeu normalement possédé n'est filtré par ce flag).
  url.searchParams.set("include_played_free_games", "true");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Steam GetOwnedGames a répondu ${res.status}`);
  }

  const data = (await res.json()) as {
    response?: { game_count?: number; games?: SteamOwnedGame[] };
  };

  if (typeof data.response?.game_count !== "number") {
    return { ok: false, reason: "private" };
  }

  return { ok: true, games: data.response.games ?? [] };
}

export function steamCoverUrl(appid: number): string {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
}

export function steamPrivacySettingsUrl(steamId64: string): string {
  return `https://steamcommunity.com/profiles/${steamId64}/edit/settings`;
}

export type ImportSteamLibraryResult =
  | { status: "imported"; count: number; newCount: number }
  | { status: "private" };

/**
 * Importe la bibliothèque Steam d'un utilisateur : upsert chaque jeu dans
 * `Game` (source STEAM) et marque `UserGame.owned = true`. Met aussi à jour
 * `User.steamPublic` pour refléter le dernier statut de visibilité constaté,
 * et `User.steamLastSyncAt` (fix bug remonté : indicateur "Dernière sync"
 * sur /profil/parametres) — posé à CHAQUE appel de cette fonction, quel
 * que soit le déclencheur (lien initial, bouton "Réimporter", cron
 * quotidien `steam-library-sync`, resync Family), pour rester la seule
 * source de vérité de "quand a-t-on parlé à l'API Steam pour ce user".
 *
 * `newCount` (fix bug remonté : nouveaux achats jamais détectés) : cette
 * fonction traite déjà TOUS les jeux renvoyés par Steam à chaque appel
 * (pas seulement ceux manquants en base) — un jeu nouvellement acheté est
 * donc upserté comme n'importe quel autre. Le vrai bug était l'absence de
 * déclenchement périodique (personne n'appelait cette fonction sans une
 * action explicite de l'utilisateur) ; `steam-library-sync`
 * (`src/app/api/cron/steam-library-sync/route.ts`) comble ce trou.
 * `newCount` (jeux que ce user ne possédait pas encore juste avant cet
 * appel) sert à distinguer un run silencieux d'un run qui a vraiment
 * trouvé du nouveau, pour le logging du cron et le message de la
 * resync Family.
 */
export async function importSteamLibrary(
  userId: string,
  steamId64: string
): Promise<ImportSteamLibraryResult> {
  const result = await getOwnedGames(steamId64);

  await prisma.user.update({
    where: { id: userId },
    data: { steamPublic: result.ok, steamLastSyncAt: wallClockNow() },
  });

  if (!result.ok) {
    return { status: "private" };
  }

  const alreadyOwnedAppIds = new Set(
    (
      await prisma.userGame.findMany({
        where: { userId, owned: true, game: { steamAppId: { not: null } } },
        select: { game: { select: { steamAppId: true } } },
      })
    ).map((ug) => ug.game.steamAppId)
  );
  let newCount = 0;

  for (const game of result.games) {
    if (!alreadyOwnedAppIds.has(game.appid)) newCount += 1;
    const dbGame = await prisma.game.upsert({
      where: { steamAppId: game.appid },
      update: { name: game.name, coverUrl: steamCoverUrl(game.appid) },
      create: {
        name: game.name,
        source: GameSource.STEAM,
        steamAppId: game.appid,
        coverUrl: steamCoverUrl(game.appid),
        // Steam ne fournit pas le nombre de joueurs : 2 par défaut (comme
        // l'ajout manuel), pas 1 — l'app sert à jouer à plusieurs, et un
        // minPlayers=1 (ou null mal géré côté calcul) affichait des jeux
        // multijoueurs comme "jouable" avec une seule personne dispo.
        minPlayers: 2,
        addedById: userId,
      },
    });

    // `source: PERSONAL` posé aussi sur `update` (pas seulement `create`) :
    // l'import Steam perso est la source la plus fiable de possession
    // réelle — si ce jeu était déjà marqué FAMILY (import biblio famille,
    // voir `family-import-actions.ts`), le fait de le posséder aussi en
    // perso est l'info la plus précise à refléter.
    await prisma.userGame.upsert({
      where: { userId_gameId: { userId, gameId: dbGame.id } },
      update: { owned: true, source: "PERSONAL" },
      create: { userId, gameId: dbGame.id, owned: true, source: "PERSONAL" },
    });
  }

  await checkLibraryBadges(userId);

  // Sprint 5 (Wishlist) — dès qu'un membre possède désormais un jeu de la
  // wishlist du groupe, l'entrée se marque "achetée" toute seule.
  await checkWishlistPurchases(userId);

  // Sprint 4 (FEATURE 4) — jeu le plus récemment joué, si Steam a renvoyé
  // au moins un timestamp exploitable (`rtime_last_played` absent ou à 0
  // pour un jeu jamais lancé). `null` sur les deux champs plutôt qu'une
  // absence de mise à jour : un compte dont plus aucun jeu récent n'a de
  // timestamp valide ne doit pas garder affiché un ancien "Joue à X" figé.
  const mostRecent = result.games
    .filter((g) => (g.rtime_last_played ?? 0) > 0)
    .sort((a, b) => (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0))[0];
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastPlayedGame: mostRecent?.name ?? null,
      lastPlayedAt: mostRecent ? new Date(mostRecent.rtime_last_played! * 1000) : null,
    },
  });

  return { status: "imported", count: result.games.length, newCount };
}
