interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Cache en mémoire du process : évite de redemander un token Twitch à
// chaque appel IGDB tant que l'instance serverless reste "chaude".
let cachedToken: CachedToken | null = null;

async function getIgdbToken(): Promise<string> {
  const clientId = process.env.IGDB_CLIENT_ID?.trim();
  const clientSecret = process.env.IGDB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET ne sont pas configurées."
    );
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Twitch OAuth (token IGDB) a répondu ${res.status}: ${body}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

interface IgdbMultiplayerMode {
  campaigncoop?: boolean;
  onlinecoopmax?: number;
  offlinecoopmax?: number;
  // Champ IGDB réel : `lancoop` (booléen) — il n'existe pas de
  // `lancoopmax`. Le demander dans `fields` faisait échouer la requête
  // entière (400) pour toute recherche, quel que soit le jeu.
  lancoop?: boolean;
  onlinemax?: number;
  offlinemax?: number;
}

interface IgdbGameResponse {
  id: number;
  name: string;
  cover?: { image_id: string };
  multiplayer_modes?: IgdbMultiplayerMode[];
}

export interface IgdbGameCandidate {
  igdbId: number;
  name: string;
  coverUrl: string | null;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
}

export function igdbCoverUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

export function igdbScreenshotUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${imageId}.jpg`;
}

/**
 * Recherche des jeux sur IGDB. La couverture des joueurs (`multiplayer_modes`)
 * est parfois vide même pour des jeux coop connus (cf. §4 du spec) : on
 * renvoie `null` plutôt qu'une valeur inventée quand IGDB ne donne rien, à
 * charge pour l'appelant de proposer une saisie manuelle.
 */
export async function searchIgdbGames(
  query: string
): Promise<IgdbGameCandidate[]> {
  const term = query.trim().replace(/["\\]/g, "");
  if (!term) return [];

  const [token, clientId] = [
    await getIgdbToken(),
    process.env.IGDB_CLIENT_ID!.trim(),
  ];

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: `search "${term}"; fields name,cover.image_id,multiplayer_modes.campaigncoop,multiplayer_modes.onlinecoopmax,multiplayer_modes.offlinecoopmax,multiplayer_modes.lancoop,multiplayer_modes.onlinemax,multiplayer_modes.offlinemax; limit 8;`,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IGDB a répondu ${res.status}: ${body}`);
  }

  const games = (await res.json()) as IgdbGameResponse[];

  return games.map((game) => {
    const modes = game.multiplayer_modes ?? [];

    const isCoop = modes.some(
      (m) =>
        m.campaigncoop ||
        m.lancoop ||
        (m.onlinecoopmax ?? 0) > 0 ||
        (m.offlinecoopmax ?? 0) > 0
    );

    const maxPlayers = modes.reduce<number | null>((max, m) => {
      const candidate = Math.max(m.onlinemax ?? 0, m.offlinemax ?? 0);
      if (candidate === 0) return max;
      return max === null ? candidate : Math.max(max, candidate);
    }, null);

    return {
      igdbId: game.id,
      name: game.name,
      coverUrl: game.cover?.image_id
        ? igdbCoverUrl(game.cover.image_id)
        : null,
      isCoop,
      minPlayers: null,
      maxPlayers,
    };
  });
}

function logIgdbMatch(
  steamAppId: number,
  name: string,
  outcome: "external_games" | "name_fallback" | "not_found" | "error",
  detail?: string
): void {
  const prefix = `[igdb-match] Steam appid=${steamAppId} "${name}"`;
  if (outcome === "not_found") {
    console.warn(
      `${prefix} → aucune correspondance IGDB (ni external_games, ni recherche par nom).`
    );
  } else if (outcome === "error") {
    console.error(`${prefix} → erreur : ${detail}`);
  } else {
    console.log(`${prefix} → matché via ${outcome}${detail ? ` (${detail})` : ""}.`);
  }
}

export interface IgdbMatchResult {
  igdbId: number | null;
  method: "external_games" | "name_fallback" | "not_found";
}

/**
 * Résout l'igdbId d'un jeu importé de Steam qui n'en a pas encore.
 * Jusqu'ici l'import Steam (`src/lib/steam.ts`) ne renseignait jamais
 * `Game.igdbId` — c'était la cause réelle des fiches sans description sur
 * les jeux Steam : la fiche ne "ratait" pas le match, elle ne le tentait
 * jamais (`getGameDetails` court-circuitait dès `!igdbId`).
 *
 * Deux méthodes, dans l'ordre :
 * 1. **`external_games`** (endpoint IGDB dédié) : recherche par
 *    `uid = "<steamAppId>"` et `category = 1` (Steam, valeur documentée
 *    de l'enum IGDB `external_games.category`) — fiable, un AppID Steam
 *    ne correspond qu'à un seul jeu IGDB.
 * 2. **Repli par nom** (`searchIgdbGames`, même recherche que l'ajout
 *    manuel) si `external_games` ne trouve rien — moins fiable (éditions,
 *    remakes, jeux au nom générique), donc seulement en dernier recours ;
 *    on prend le premier résultat (déjà trié par pertinence par IGDB).
 *
 * Logge systématiquement le résultat (méthode utilisée, ambiguïté du
 * repli par nom, erreur réseau/API, ou échec complet) pour pouvoir
 * déboguer les jeux qui restent sans fiche après cette résolution.
 */
export async function resolveIgdbIdForSteamGame(
  steamAppId: number,
  name: string
): Promise<IgdbMatchResult> {
  try {
    const [token, clientId] = [
      await getIgdbToken(),
      process.env.IGDB_CLIENT_ID!.trim(),
    ];

    const res = await fetch("https://api.igdb.com/v4/external_games", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: `fields game; where uid = "${steamAppId}" & category = 1; limit 1;`,
    });

    if (res.ok) {
      const rows = (await res.json()) as { game?: number }[];
      const igdbId = rows[0]?.game ?? null;
      if (igdbId) {
        logIgdbMatch(steamAppId, name, "external_games");
        return { igdbId, method: "external_games" };
      }
    } else {
      const body = await res.text().catch(() => "");
      logIgdbMatch(
        steamAppId,
        name,
        "error",
        `external_games a répondu ${res.status}: ${body}`
      );
    }
  } catch (err) {
    logIgdbMatch(
      steamAppId,
      name,
      "error",
      `external_games : ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const candidates = await searchIgdbGames(name);
    if (candidates.length > 0) {
      logIgdbMatch(
        steamAppId,
        name,
        "name_fallback",
        candidates.length > 1
          ? `${candidates.length} résultats, ambigu, on prend le 1er`
          : undefined
      );
      return { igdbId: candidates[0].igdbId, method: "name_fallback" };
    }
  } catch (err) {
    logIgdbMatch(
      steamAppId,
      name,
      "error",
      `recherche par nom : ${err instanceof Error ? err.message : String(err)}`
    );
  }

  logIgdbMatch(steamAppId, name, "not_found");
  return { igdbId: null, method: "not_found" };
}

interface IgdbInvolvedCompany {
  company: { name: string };
  developer: boolean;
  publisher: boolean;
}

interface IgdbGameDetailsResponse {
  id: number;
  name: string;
  summary?: string;
  total_rating?: number;
  cover?: { image_id: string };
  screenshots?: { image_id: string }[];
  videos?: { video_id: string }[];
  platforms?: { name: string }[];
  genres?: { name: string }[];
  first_release_date?: number; // timestamp Unix (secondes)
  involved_companies?: IgdbInvolvedCompany[];
}

export interface IgdbGameDetails {
  igdbId: number;
  name: string;
  summary: string | null;
  /**
   * Traduction FR de `summary` (DeepL), remplie par
   * `src/lib/game-details.ts` après l'appel IGDB — toujours `null` en
   * sortie de `fetchIgdbGameDetails` elle-même, qui reste un simple
   * client de l'API IGDB (pas de dépendance à DeepL ici).
   */
  descriptionFr: string | null;
  /** Note globale IGDB (`total_rating`), arrondie sur 100. */
  totalRating: number | null;
  coverUrl: string | null;
  screenshotUrls: string[];
  /** Ids de vidéos YouTube (champ IGDB `videos.video_id`). */
  youtubeVideoIds: string[];
  platforms: string[];
  genres: string[];
  /** ISO 8601, ou `null` si inconnue. */
  releaseDate: string | null;
  developers: string[];
  publishers: string[];
}

/**
 * Récupère la fiche détaillée d'un jeu IGDB par son id (pas de recherche
 * par nom ici — appelé une fois l'`igdbId` déjà connu, soit depuis l'ajout
 * manuel enrichi, soit depuis un import Steam déjà matché). Ne fait
 * aucun cache : c'est `src/lib/game-details.ts` qui gère le cache en base
 * et l'appel à la demande.
 */
export async function fetchIgdbGameDetails(
  igdbId: number
): Promise<IgdbGameDetails | null> {
  const [token, clientId] = [
    await getIgdbToken(),
    process.env.IGDB_CLIENT_ID!.trim(),
  ];

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: `where id = ${igdbId}; fields name,summary,total_rating,cover.image_id,screenshots.image_id,videos.video_id,platforms.name,genres.name,first_release_date,involved_companies.company.name,involved_companies.developer,involved_companies.publisher; limit 1;`,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IGDB (fiche jeu #${igdbId}) a répondu ${res.status}: ${body}`);
  }

  const [game] = (await res.json()) as IgdbGameDetailsResponse[];
  if (!game) return null;

  const companies = game.involved_companies ?? [];

  return {
    igdbId: game.id,
    name: game.name,
    summary: game.summary ?? null,
    descriptionFr: null,
    totalRating:
      typeof game.total_rating === "number"
        ? Math.round(game.total_rating)
        : null,
    coverUrl: game.cover?.image_id ? igdbCoverUrl(game.cover.image_id) : null,
    screenshotUrls: (game.screenshots ?? []).map((s) =>
      igdbScreenshotUrl(s.image_id)
    ),
    youtubeVideoIds: (game.videos ?? []).map((v) => v.video_id),
    platforms: (game.platforms ?? []).map((p) => p.name),
    genres: (game.genres ?? []).map((g) => g.name),
    releaseDate: game.first_release_date
      ? new Date(game.first_release_date * 1000).toISOString()
      : null,
    developers: companies.filter((c) => c.developer).map((c) => c.company.name),
    publishers: companies.filter((c) => c.publisher).map((c) => c.company.name),
  };
}
