import { GameSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkLibraryBadges } from "@/lib/badges";
import { checkWishlistPurchases } from "@/lib/wishlist";
import { wallClockNow, formatDurationFr } from "@/lib/wallclock";
import { logger } from "@/lib/logger";

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
// SteamID64 : toujours 17 chiffres.
const STEAM_ID_REGEX = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const OPENID_NS = "http://specs.openid.net/auth/2.0";
// Champs que Steam doit avoir signés : sans eux, l'assertion pourrait être
// rejouée ailleurs (return_to, nonce) ou l'identité modifiée (claimed_id).
const REQUIRED_SIGNED = ["op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"];
const NONCE_MAX_AGE_MS = 5 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 10_000;

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
 * Vérifie la réponse OpenID 2.0 de Steam. Contrôles locaux d'abord (sans
 * réseau) : ns/mode/op_endpoint, `return_to` STRICTEMENT égal à celui
 * attendu (il porte le `state` à usage unique, voir `steam/link`),
 * champs essentiels signés, `response_nonce` de moins de 5 min,
 * `claimed_id` strict (17 chiffres) égal à `identity`. Puis
 * `check_authentication` auprès de Steam (obligatoire : seul Steam peut
 * valider la signature). Retourne le SteamID64, ou `null` si l'assertion
 * est invalide ; LÈVE si Steam est injoignable (≠ invalide).
 */
export async function verifySteamOpenId(
  query: URLSearchParams,
  expectedReturnTo: string,
  now: Date = new Date()
): Promise<string | null> {
  if (query.get("openid.ns") !== OPENID_NS) return null;
  if (query.get("openid.mode") !== "id_res") return null;
  if (query.get("openid.op_endpoint") !== STEAM_OPENID_ENDPOINT) return null;
  if (query.get("openid.return_to") !== expectedReturnTo) return null;

  const signed = new Set((query.get("openid.signed") ?? "").split(","));
  if (!REQUIRED_SIGNED.every((field) => signed.has(field))) return null;

  const nonceTime = Date.parse((query.get("openid.response_nonce") ?? "").slice(0, 20));
  if (Number.isNaN(nonceTime) || Math.abs(now.getTime() - nonceTime) > NONCE_MAX_AGE_MS) return null;

  const claimedId = query.get("openid.claimed_id") ?? "";
  const match = STEAM_ID_REGEX.exec(claimedId);
  if (!match || query.get("openid.identity") !== claimedId) return null;

  // Seuls les paramètres openid.* repartent vers Steam (jamais `state`).
  const params = new URLSearchParams();
  for (const [key, value] of query) {
    if (key.startsWith("openid.")) params.append(key, value);
  }
  params.set("openid.mode", "check_authentication");

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Steam OpenID a répondu ${res.status}`);
  const text = await res.text();
  return text.split("\n").some((line) => line.trim() === "is_valid:true") ? match[1] : null;
}

export interface SteamOwnedGame {
  appid: number;
  name: string;
  // Sprint 4 (FEATURE 4, dernière activité Steam) — timestamp Unix
  // (secondes) renvoyé par Steam pour certains jeux possédés, NON
  // documenté officiellement par Valve (absent de la référence
  // ISteamWebAPI de `GetOwnedGames`). Investigation post-déploiement
  // (fix "activité Steam invisible") : en Production, avec une
  // bibliothèque correctement importée (compteur de jeux exact, badge
  // "Collectionneur" déclenché), ce champ n'a jamais permis de calculer
  // de jeu récent — cohérent avec un champ non garanti par le contrat
  // officiel de cet endpoint plutôt qu'avec un bug de ce fichier (lu,
  // filtré, trié et converti correctement, vérifié ligne à ligne).
  // Conservé en tentative PRIORITAIRE (donnée la plus précise si elle
  // arrive un jour à être renseignée) mais plus comme unique source —
  // voir `getRecentlyPlayedGames` ci-dessous pour le repli officiel.
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
export interface SteamCallOptions {
  /** Optionnel — permet d'imposer un timeout individuel (ex. `AbortSignal.timeout(ms)`), utilisé par `refreshSteamActivity` (jamais par `importSteamLibrary`, qui garde son comportement d'origine sans signal). */
  signal?: AbortSignal;
}

export async function getOwnedGames(
  steamId64: string,
  options?: SteamCallOptions
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

  const res = await fetch(url, { cache: "no-store", signal: options?.signal });
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

export interface SteamRecentGame {
  appid: number;
  name: string;
  // Minutes jouées sur les 2 dernières semaines — PAS un timestamp, cf.
  // docstring de la fonction ci-dessous.
  playtime_2weeks?: number;
  playtime_forever?: number;
}

/**
 * Repli OFFICIELLEMENT documenté (`IPlayerService/GetRecentlyPlayedGames`,
 * référence ISteamWebAPI de Valve) — contrairement à `rtime_last_played`
 * (`getOwnedGames` ci-dessus, non documenté et jamais confirmé fiable en
 * Prod, cf. investigation "activité Steam invisible"). Limite assumée et
 * inhérente à cet endpoint : fenêtre glissante de 2 semaines seulement, et
 * AUCUN timestamp exact — seulement des minutes jouées (`playtime_2weeks`).
 * Impossible d'en dériver un "il y a X heures" précis ; voir
 * `formatSteamActivityLabel` pour le libellé dégradé qui en découle
 * ("a joué récemment", sans durée).
 *
 * L'ordre des jeux dans la réponse n'est PAS contractuellement garanti par
 * la documentation Valve — `importSteamLibrary` ne se fie donc jamais à
 * l'ordre renvoyé et retrie explicitement par `playtime_2weeks` décroissant
 * pour un choix déterministe.
 *
 * Appelée UNIQUEMENT en repli (jamais systématiquement) — voir
 * `importSteamLibrary` : seulement quand `rtime_last_played` n'a permis de
 * retenir aucun jeu, pour ne jamais doubler inutilement les appels Steam.
 */
export async function getRecentlyPlayedGames(
  steamId64: string,
  options?: SteamCallOptions
): Promise<SteamRecentGame[]> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) throw new Error("STEAM_API_KEY n'est pas configurée.");

  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/"
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamid", steamId64);
  url.searchParams.set("format", "json");

  const res = await fetch(url, { cache: "no-store", signal: options?.signal });
  if (!res.ok) {
    throw new Error(`Steam GetRecentlyPlayedGames a répondu ${res.status}`);
  }

  const data = (await res.json()) as {
    response?: { games?: SteamRecentGame[] };
  };

  return data.response?.games ?? [];
}

/** Jeu avec le `rtime_last_played` le plus récent (> 0), ou `undefined` si aucun n'est exploitable. Pure, extraite pour être testable sans mock Prisma/réseau. */
export function selectMostRecentByTimestamp(
  games: SteamOwnedGame[]
): SteamOwnedGame | undefined {
  return games
    .filter((g) => (g.rtime_last_played ?? 0) > 0)
    .sort((a, b) => (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0))[0];
}

/** Jeu avec le plus de `playtime_2weeks`, ou `undefined` si la liste est vide — sélection déterministe, cf. docstring de `getRecentlyPlayedGames` (ordre non garanti par Valve). Pure. */
export function selectMostRecentByPlaytime(
  games: SteamRecentGame[]
): SteamRecentGame | undefined {
  return [...games].sort((a, b) => (b.playtime_2weeks ?? 0) - (a.playtime_2weeks ?? 0))[0];
}

export interface SteamActivityUpdate {
  lastPlayedGame: string | null;
  lastPlayedAt: Date | null;
}

/** Résultat du repli `GetRecentlyPlayedGames` — `undefined` si non appelé (le niveau précis a déjà trouvé un jeu, cf. `importSteamLibrary`). */
export type RecentGamesOutcome = { status: "success"; games: SteamRecentGame[] } | { status: "error" };

/**
 * Décision PURE (fix "activité Steam invisible") — que faut-il écrire pour
 * `lastPlayedGame`/`lastPlayedAt` ? Séparée de tout accès Prisma/réseau
 * pour rester testable sans mock (convention déjà établie dans ce dépôt —
 * `isLockAvailable`/`checkCronAuth`/`resolveAppOrigin` suivent le même
 * principe). `null` en retour = ne rien écrire du tout, conserver la
 * valeur déjà en base (cas d'erreur réseau sur le repli — jamais remplacer
 * une info valide par du vide silencieusement).
 *
 * Ordre de priorité :
 * 1. `rtime_last_played` exploitable (précis, source non garantie mais
 *    prioritaire quand elle répond) → timestamp exact.
 * 2. Repli réussi avec au moins un jeu récent → nom seul, `lastPlayedAt`
 *    délibérément `null` (jamais de date fabriquée à partir d'autre chose
 *    que `rtime_last_played` — ni `steamLastSyncAt`, ni le temps de jeu).
 * 3. Repli réussi mais liste vide → aucune activité récente, les DEUX
 *    champs sont explicitement remis à `null` (un compte qui n'a plus
 *    rien joué sur les 2 dernières semaines ne doit pas garder affiché un
 *    ancien jeu figé).
 * 4. Repli en erreur (réseau/timeout/réponse invalide) → `null` global,
 *    l'appelant ne touche pas la ligne en base.
 */
export function computeSteamActivityUpdate(
  ownedGames: SteamOwnedGame[],
  recentGamesOutcome?: RecentGamesOutcome
): SteamActivityUpdate | null {
  const mostRecent = selectMostRecentByTimestamp(ownedGames);
  if (mostRecent) {
    return {
      lastPlayedGame: mostRecent.name,
      lastPlayedAt: new Date(mostRecent.rtime_last_played! * 1000),
    };
  }

  if (!recentGamesOutcome || recentGamesOutcome.status === "error") return null;

  const best = selectMostRecentByPlaytime(recentGamesOutcome.games);
  return { lastPlayedGame: best?.name ?? null, lastPlayedAt: null };
}

/**
 * Timeout individuel par appel Steam pour le rafraîchissement léger
 * (`refreshSteamActivity`, cron `steam-library-sync` toutes les ~2 min) —
 * fix "cron Steam surdimensionné". Calcul du pire cas validé : lots de 3
 * (`processInBatches`), jusqu'à 2 appels Steam séquentiels par compte
 * (précis puis repli) → pour 5 comptes, 2 lots successifs (3 puis 2) × 2
 * appels × 6s = 24s, sous les 30s du déclencheur cron-job.org ET sous le
 * `maxDuration` Vercel déclaré sur la route (budget de temps route en plus,
 * filet de sécurité). JAMAIS utilisé par `importSteamLibrary` (pas de
 * `signal` passé), qui garde son comportement d'origine sans timeout
 * individuel.
 */
export const STEAM_ACTIVITY_CALL_TIMEOUT_MS = 6_000;

export type SteamActivityCategory =
  | "precise"
  | "approximate"
  | "none"
  | "private"
  | "error";

/**
 * Résultat catégorisé du rafraîchissement léger — distinct de
 * `SteamActivityUpdate`/`computeSteamActivityUpdate` (utilisés par
 * `importSteamLibrary`, non touchés, pour ne rien risquer sur l'import
 * complet) : ici il faut aussi distinguer "erreur" de "profil privé" et de
 * "aucune activité récente" pour l'observabilité du cron (5 catégories
 * demandées), alors que `computeSteamActivityUpdate` traite ces trois cas de
 * façon uniforme (retourne `null`/champs vides) car `importSteamLibrary` n'a
 * pas besoin de les distinguer.
 */
export type ActivityRefreshOutcome =
  | { category: "private" }
  | { category: "precise"; lastPlayedGame: string; lastPlayedAt: Date }
  | { category: "approximate"; lastPlayedGame: string }
  | { category: "none" }
  | { category: "error" };

/**
 * Décision PURE (fix "cron Steam surdimensionné") — catégorise le résultat
 * d'un appel `getOwnedGames` (+ éventuel repli `getRecentlyPlayedGames`)
 * pour le rafraîchissement léger. Ne fait aucun accès Prisma/réseau, comme
 * `computeSteamActivityUpdate`. `recentGamesOutcome` n'est fourni par
 * l'appelant que lorsque le niveau précis n'a rien trouvé (jamais appelé
 * sinon, cf. `refreshSteamActivity`) — son absence alors que le profil est
 * public et sans `rtime_last_played` exploitable est traitée comme une
 * erreur (l'appelant n'a pas pu tenter le repli, par ex. budget de temps
 * épuisé).
 */
export function categorizeActivityOutcome(
  ownedGamesResult: GetOwnedGamesResult,
  recentGamesOutcome?: RecentGamesOutcome
): ActivityRefreshOutcome {
  if (!ownedGamesResult.ok) return { category: "private" };

  const mostRecent = selectMostRecentByTimestamp(ownedGamesResult.games);
  if (mostRecent) {
    return {
      category: "precise",
      lastPlayedGame: mostRecent.name,
      lastPlayedAt: new Date(mostRecent.rtime_last_played! * 1000),
    };
  }

  if (!recentGamesOutcome || recentGamesOutcome.status === "error") {
    return { category: "error" };
  }

  const best = selectMostRecentByPlaytime(recentGamesOutcome.games);
  if (best) return { category: "approximate", lastPlayedGame: best.name };
  return { category: "none" };
}

/**
 * Décision PURE du repli DÉGRADÉ de `refreshSteamActivity` : `getOwnedGames`
 * (appel lourd, catalogue entier avec `include_appinfo`) a échoué
 * (timeout, 429, 5xx) alors que `getRecentlyPlayedGames` (appel léger,
 * officiel) peut encore répondre. Une liste NON vide donne l'activité
 * approximative habituelle. Une liste VIDE est ambiguë (profil privé ?
 * vraiment aucune partie sur 2 semaines ?) : ce n'est PAS une preuve
 * d'absence d'activité, donc "error" — l'activité déjà en base n'est jamais
 * effacée sur la foi d'un appel qui n'a pas pu distinguer les deux cas
 * (seul `getOwnedGames` sait distinguer un profil privé).
 */
export function categorizeRecentOnlyOutcome(games: SteamRecentGame[]): ActivityRefreshOutcome {
  const best = selectMostRecentByPlaytime(games);
  return best ? { category: "approximate", lastPlayedGame: best.name } : { category: "error" };
}

/**
 * Écriture PURE (fix "cron Steam surdimensionné") — traduit une
 * `ActivityRefreshOutcome` en objet `data` pour `prisma.user.update`, sans
 * jamais appeler Prisma elle-même (testable sans mock). Règles validées
 * avec l'utilisateur :
 * - `steamActivityCheckedAt` est TOUJOURS posé (c'est la sémantique même du
 *   champ — "dernière tentative", succès ou erreur confondus) ;
 * - "error" ne touche NI `steamPublic` NI l'activité affichée — une panne
 *   réseau/timeout transitoire ne doit jamais effacer une info valide déjà
 *   en base ;
 * - "private" efface explicitement l'activité affichée (`lastPlayedGame`/
 *   `lastPlayedAt` → `null`) — ni `/potes` ni `/profil` ne filtrent sur
 *   `steamPublic` à l'affichage (vérifié), donc une activité obsolète
 *   resterait visible indéfiniment sans cet effacement explicite ;
 * - "precise"/"approximate"/"none" posent `steamPublic: true` (on sait que
 *   `getOwnedGames` a réussi) avec l'activité correspondante.
 */
export function buildActivityRefreshWrite(
  outcome: ActivityRefreshOutcome,
  now: Date
): {
  steamActivityCheckedAt: Date;
  steamPublic?: boolean;
  lastPlayedGame?: string | null;
  lastPlayedAt?: Date | null;
} {
  switch (outcome.category) {
    case "error":
      return { steamActivityCheckedAt: now };
    case "private":
      return {
        steamActivityCheckedAt: now,
        steamPublic: false,
        lastPlayedGame: null,
        lastPlayedAt: null,
      };
    case "precise":
      return {
        steamActivityCheckedAt: now,
        steamPublic: true,
        lastPlayedGame: outcome.lastPlayedGame,
        lastPlayedAt: outcome.lastPlayedAt,
      };
    case "approximate":
      return {
        steamActivityCheckedAt: now,
        steamPublic: true,
        lastPlayedGame: outcome.lastPlayedGame,
        lastPlayedAt: null,
      };
    case "none":
      return {
        steamActivityCheckedAt: now,
        steamPublic: true,
        lastPlayedGame: null,
        lastPlayedAt: null,
      };
  }
}

/**
 * Rafraîchissement LÉGER de l'activité Steam (fix "cron Steam
 * surdimensionné") — appelé par le cron `steam-library-sync` toutes les
 * ~2 min, à la place d'`importSteamLibrary` qui réimportait toute la
 * bibliothèque (upserts `Game`/`UserGame`, badges, wishlist) rien que pour
 * rafraîchir un libellé d'activité. Ici : UNIQUEMENT `getOwnedGames` (et son
 * repli `getRecentlyPlayedGames` si besoin), AUCUN upsert, AUCUN badge,
 * AUCUNE vérification wishlist, et une seule écriture `prisma.user.update`
 * par compte.
 *
 * Isolation par utilisateur : chaque appel Steam individuel est borné par
 * `AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS)` — un compte qui
 * bloque ou répond lentement ne peut jamais affecter les autres (ni les
 * bloquer, ni consommer leur propre budget de temps), et une erreur ici ne
 * doit jamais interrompre le lot appelant (`processInBatches` isole déjà
 * chaque `worker` via `Promise.allSettled, mais on catch aussi ici pour
 * pouvoir écrire `steamActivityCheckedAt` même en cas d'échec).
 *
 * N'écrit jamais `steamLastSyncAt` (réservé exclusivement à
 * `importSteamLibrary`, une synchronisation complète réussie) — voir
 * `steamActivityCheckedAt` à la place.
 */
export async function refreshSteamActivity(
  userId: string,
  steamId64: string
): Promise<{ userId: string; category: SteamActivityCategory; degraded?: boolean }> {
  let ownedGamesResult: GetOwnedGamesResult;
  try {
    ownedGamesResult = await getOwnedGames(steamId64, {
      signal: AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error("steam-activity", error, { userId, step: "owned-games" });
    // Repli DÉGRADÉ (fix "dernière activité absente de /potes") : l'appel
    // lourd a échoué, mais l'appel léger officiel peut répondre — avant, ce
    // cas laissait l'activité vide indéfiniment pour tout compte dont le
    // catalogue dépassait le timeout de 6 s. Même pire cas qu'avant (au plus
    // 2 appels Steam séquentiels par compte, voir
    // STEAM_ACTIVITY_CALL_TIMEOUT_MS) : le repli n'est jamais cumulé avec le
    // repli habituel ci-dessous (ici `getOwnedGames` n'a pas répondu).
    let outcome: ActivityRefreshOutcome;
    try {
      const games = await getRecentlyPlayedGames(steamId64, {
        signal: AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS),
      });
      outcome = categorizeRecentOnlyOutcome(games);
    } catch (fallbackError) {
      logger.error("steam-activity", fallbackError, { userId, step: "recently-played-degraded" });
      outcome = { category: "error" };
    }
    await prisma.user.update({ where: { id: userId }, data: buildActivityRefreshWrite(outcome, wallClockNow()) });
    return outcome.category === "approximate"
      ? { userId, category: "approximate", degraded: true }
      : { userId, category: "error" };
  }

  let recentGamesOutcome: RecentGamesOutcome | undefined;
  if (ownedGamesResult.ok && !selectMostRecentByTimestamp(ownedGamesResult.games)) {
    try {
      const games = await getRecentlyPlayedGames(steamId64, {
        signal: AbortSignal.timeout(STEAM_ACTIVITY_CALL_TIMEOUT_MS),
      });
      recentGamesOutcome = { status: "success", games };
    } catch (error) {
      logger.error("steam-activity", error, { userId, step: "recently-played-fallback" });
      recentGamesOutcome = { status: "error" };
    }
  }

  const outcome = categorizeActivityOutcome(ownedGamesResult, recentGamesOutcome);
  const write = buildActivityRefreshWrite(outcome, wallClockNow());
  await prisma.user.update({ where: { id: userId }, data: write });

  return { userId, category: outcome.category };
}

/**
 * Libellé FR affiché sur `/potes` et l'en-tête `/profil` — honnête sur la
 * précision réelle de la donnée (fix "Joue à" trompeur, qui prétendait à
 * tort une activité EN COURS alors que la donnée est toujours une activité
 * PASSÉE, précise ou non selon la source qui a pu la fournir) :
 * - `lastPlayedAt` connu (timestamp exact, source `rtime_last_played`) →
 *   "A joué à X — il y a Y" ;
 * - `lastPlayedAt` absent mais `lastPlayedGame` connu (repli
 *   `GetRecentlyPlayedGames`, aucun timestamp exact disponible) → "A joué
 *   récemment à X", sans durée fabriquée ;
 * - aucun jeu connu → `null` (rien affiché), jamais de texte par défaut.
 */
export function formatSteamActivityLabel(
  lastPlayedGame: string | null,
  lastPlayedAt: Date | null,
  nowMsValue: number
): string | null {
  if (!lastPlayedGame) return null;
  if (lastPlayedAt) {
    return `A joué à ${lastPlayedGame} — il y a ${formatDurationFr(nowMsValue - lastPlayedAt.getTime())}`;
  }
  return `A joué récemment à ${lastPlayedGame}`;
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
export type ImportSteamLibraryResultWithBudget =
  | ImportSteamLibraryResult
  | { status: "partial"; processed: number; total: number };

// `opts.deadlineMs` (timestamp `Date.now()` absolu, utilisé seulement par le
// cron `steam-library-full-sync`) : la boucle d'upserts s'arrête dès qu'il est
// dépassé et renvoie `partial` SANS badges/wishlist/`steamLastSyncAt` (réservé
// au succès complet). Les upserts déjà faits restent (idempotents). Sans
// `opts` : comportement historique, aucun budget, jamais de `partial`.
export async function importSteamLibrary(
  userId: string,
  steamId64: string
): Promise<ImportSteamLibraryResult>;
export async function importSteamLibrary(
  userId: string,
  steamId64: string,
  opts: { deadlineMs: number }
): Promise<ImportSteamLibraryResultWithBudget>;
export async function importSteamLibrary(
  userId: string,
  steamId64: string,
  opts?: { deadlineMs: number }
): Promise<ImportSteamLibraryResultWithBudget> {
  const result = await getOwnedGames(steamId64);

  if (!result.ok) {
    await prisma.user.update({
      where: { id: userId },
      data: { steamPublic: false, steamLastSyncAt: wallClockNow() },
    });
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
  let processed = 0;

  for (const game of result.games) {
    if (opts && Date.now() > opts.deadlineMs) {
      return { status: "partial", processed, total: result.games.length };
    }
    processed += 1;
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

  // Sprint 4 (FEATURE 4) suite (fix "activité Steam invisible") — deux
  // niveaux, décision déléguée à `computeSteamActivityUpdate` (pure,
  // testée séparément). Le repli `GetRecentlyPlayedGames` n'est appelé
  // QUE si `rtime_last_played` n'a permis de retenir aucun jeu — jamais
  // systématiquement, jamais doublé.
  let recentGamesOutcome: RecentGamesOutcome | undefined;
  if (!selectMostRecentByTimestamp(result.games)) {
    try {
      recentGamesOutcome = { status: "success", games: await getRecentlyPlayedGames(steamId64) };
    } catch (error) {
      // Erreur réseau/timeout/réponse invalide : `computeSteamActivityUpdate`
      // renverra `null` pour ce statut — la ligne en base n'est PAS touchée,
      // une ancienne valeur valide n'est jamais remplacée par du vide.
      logger.error("steam", error, { userId, step: "recently-played-fallback" });
      recentGamesOutcome = { status: "error" };
    }
  }

  const activityUpdate = computeSteamActivityUpdate(result.games, recentGamesOutcome);

  // Fix (rotation import complet non fiable) — `steamPublic`/`steamLastSyncAt`
  // ne sont plus posés dès la réponse `getOwnedGames`, mais fusionnés ici en
  // UNE SEULE écriture finale, atteinte seulement après le succès complet
  // des upserts/badges/wishlist ci-dessus : un import interrompu en cours de
  // route (crash, timeout) ne laisse plus `steamLastSyncAt` prétendre à tort
  // à une synchronisation réussie.
  await prisma.user.update({
    where: { id: userId },
    data: {
      steamPublic: true,
      steamLastSyncAt: wallClockNow(),
      ...(activityUpdate ?? {}),
    },
  });

  return { status: "imported", count: result.games.length, newCount };
}
