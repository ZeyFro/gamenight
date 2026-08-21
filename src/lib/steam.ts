import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  | { status: "imported"; count: number }
  | { status: "private" };

/**
 * Importe la bibliothèque Steam d'un utilisateur : upsert chaque jeu dans
 * `Game` (source STEAM) et marque `UserGame.owned = true`. Met aussi à jour
 * `User.steamPublic` pour refléter le dernier statut de visibilité constaté.
 */
export async function importSteamLibrary(
  userId: string,
  steamId64: string
): Promise<ImportSteamLibraryResult> {
  const result = await getOwnedGames(steamId64);

  await prisma.user.update({
    where: { id: userId },
    data: { steamPublic: result.ok },
  });

  if (!result.ok) {
    return { status: "private" };
  }

  for (const game of result.games) {
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

    await prisma.userGame.upsert({
      where: { userId_gameId: { userId, gameId: dbGame.id } },
      update: { owned: true },
      create: { userId, gameId: dbGame.id, owned: true },
    });
  }

  return { status: "imported", count: result.games.length };
}
