import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { STEAM_ACTIVITY_CALL_TIMEOUT_MS } from "@/lib/steam";

/**
 * « En jeu maintenant » sur /potes — NOUVEAU drapeau `STEAM_NOW_PLAYING_ENABLED`
 * (éteint par défaut, actif seulement si la valeur vaut exactement `true`).
 *
 * Pourquoi un appel de plus : l'activité déjà récupérée (`GetOwnedGames`,
 * `GetRecentlyPlayedGames`) décrit un PASSÉ (minutes jouées sur 2 semaines,
 * aucun horodatage fiable en production) — elle ne dit jamais « en jeu
 * maintenant », et le libellé « Joue à » avait déjà été retiré une fois
 * parce qu'il prétendait à tort une activité en cours. L'état courant n'est
 * fourni que par `ISteamUser/GetPlayerSummaries` (`gameextrainfo`, présent
 * seulement pendant une partie). Un SEUL appel groupé (jusqu'à 100 comptes)
 * par passage du cron léger `steam-library-sync`. La cadence reste celle
 * de l'opérateur. Drapeau éteint : aucun appel,
 * aucune écriture, aucun affichage.
 *
 * Limite assumée : Steam ne renvoie `gameextrainfo` que si les « Détails du
 * jeu » du profil sont publics — un compte privé n'apparaît jamais « en jeu »
 * (indiscernable de « pas en jeu »).
 */

export const NOW_PLAYING_FLAG = "STEAM_NOW_PLAYING_ENABLED";

/** Une observation « en jeu » reste affichée au plus ce temps, quelle que soit la cadence du cron. */
export const NOW_PLAYING_FRESH_MS = 10 * 60 * 1000;

const SUMMARIES_BATCH_SIZE = 100;

export function isNowPlayingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[NOW_PLAYING_FLAG] === "true";
}

/**
 * Pure — nom du jeu à afficher « en jeu », ou `null`. Exige une observation
 * RÉCENTE : si le cron s'arrête ou que Steam ne répond plus, l'indicateur
 * s'éteint de lui-même au lieu de rester affiché indéfiniment. `seenAt` dans
 * le futur (décalage d'horloge) est traité comme invalide.
 */
export function activeNowPlaying(
  game: string | null | undefined,
  seenAt: Date | null | undefined,
  nowMs: number
): string | null {
  if (!game || !seenAt) return null;
  const age = nowMs - seenAt.getTime();
  if (age < 0 || age > NOW_PLAYING_FRESH_MS) return null;
  return game;
}

/**
 * `ISteamUser/GetPlayerSummaries` pour un lot de comptes → nom du jeu en
 * cours (`null` si pas en jeu ou détails privés). Les identifiants absents de
 * la réponse n'apparaissent PAS dans la `Map` (jamais interprétés comme « pas
 * en jeu »). Lève une erreur sur toute réponse HTTP non valide.
 */
export async function getPlayersNowPlaying(
  steamIds: string[],
  options?: { signal?: AbortSignal }
): Promise<Map<string, string | null>> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) throw new Error("STEAM_API_KEY n'est pas configurée.");

  const result = new Map<string, string | null>();
  for (let i = 0; i < steamIds.length; i += SUMMARIES_BATCH_SIZE) {
    const batch = steamIds.slice(i, i + SUMMARIES_BATCH_SIZE);
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", batch.join(","));
    url.searchParams.set("format", "json");

    const res = await fetch(url, { cache: "no-store", signal: options?.signal });
    if (!res.ok) throw new Error(`Steam GetPlayerSummaries a répondu ${res.status}`);

    const data = (await res.json()) as {
      response?: { players?: Array<{ steamid?: string; gameextrainfo?: string }> };
    };
    for (const player of data.response?.players ?? []) {
      if (!player.steamid) continue;
      const game = player.gameextrainfo?.trim();
      result.set(player.steamid, game ? game : null);
    }
  }
  return result;
}

export interface NowPlayingRefreshResult {
  enabled: boolean;
  /** Comptes dont l'état a été relu avec succès (présents dans la réponse Steam). */
  checked: number;
  playing: number;
  error: boolean;
}

/**
 * Relit l'état « en jeu » en un appel par lot Steam, puis ne réécrit pas
 * les comptes déjà inactifs. Une partie en cours renouvelle son horodatage
 * même si le jeu ne change pas, pour conserver la péremption de 10 minutes.
 * Aucune erreur ne remonte (le cron d'activité qui l'accompagne ne doit
 * jamais en dépendre) : un échec est journalisé et RIEN n'est écrit — l'état
 * déjà en base reste, et s'éteint seul par péremption (`activeNowPlaying`).
 */
export async function refreshSteamNowPlaying(
  users: ReadonlyArray<{ id: string; steamId64: string | null }>
): Promise<NowPlayingRefreshResult> {
  if (!isNowPlayingEnabled()) return { enabled: false, checked: 0, playing: 0, error: false };

  const linked = users.filter((u): u is { id: string; steamId64: string } => Boolean(u.steamId64));
  if (linked.length === 0) return { enabled: true, checked: 0, playing: 0, error: false };

  let snapshot: Map<string, string | null>;
  try {
    snapshot = await getPlayersNowPlaying(
      linked.map((u) => u.steamId64),
      { signal: AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS) }
    );
  } catch (error) {
    logger.error("steam-now-playing", error, { accounts: linked.length });
    return { enabled: true, checked: 0, playing: 0, error: true };
  }

  const observed = linked.filter((user) => snapshot.has(user.steamId64));
  if (observed.length === 0) return { enabled: true, checked: 0, playing: 0, error: false };

  // Une lecture groupée remplace les écritures répétées des comptes déjà
  // inactifs. Ne jamais déduire l'inactivité d'une réponse Steam absente.
  let stored;
  try {
    stored = await prisma.user.findMany({
      where: { OR: observed.map(({ id, steamId64 }) => ({ id, steamId64 })) },
      select: { id: true, steamNowPlaying: true, steamNowPlayingSeenAt: true },
    });
  } catch (error) {
    logger.error("steam-now-playing", error, { accounts: observed.length, step: "read" });
    return { enabled: true, checked: 0, playing: 0, error: true };
  }
  const byId = new Map(stored.map((user) => [user.id, user]));

  const seenAt = new Date();
  let checked = 0;
  let playing = 0;
  let writeFailed = false;
  for (const user of observed) {
    const game = snapshot.get(user.steamId64) ?? null;
    const previous = byId.get(user.id);
    if (!previous) {
      logger.error("steam-now-playing", new Error("Compte supprimé ou Steam détaché pendant la lecture."), { userId: user.id, step: "read" });
      writeFailed = true;
      continue;
    }
    if (!game && previous.steamNowPlaying === null && previous.steamNowPlayingSeenAt === null) {
      checked += 1;
      continue;
    }
    try {
      await prisma.user.update({
        // Ne pas appliquer une observation d'un ancien compte Steam après
        // un détachement ou un changement de liaison pendant le passage.
        where: { id: user.id, steamId64: user.steamId64 },
        select: { id: true },
        data: game
          ? { steamNowPlaying: game, steamNowPlayingSeenAt: seenAt }
          : { steamNowPlaying: null, steamNowPlayingSeenAt: null },
      });
    } catch (error) {
      // Un compte supprimé entre-temps (ou une panne ponctuelle) ne doit
      // jamais empêcher les autres : journalisé, jamais avalé en silence.
      logger.error("steam-now-playing", error, { userId: user.id, step: "write" });
      writeFailed = true;
      continue;
    }
    checked += 1;
    if (game) playing += 1;
  }
  return { enabled: true, checked, playing, error: writeFailed };
}
