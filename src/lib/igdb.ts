interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Cache en mémoire du process : évite de redemander un token Twitch à
// chaque appel IGDB tant que l'instance serverless reste "chaude".
let cachedToken: CachedToken | null = null;

async function getIgdbToken(): Promise<string> {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
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
    throw new Error(`Twitch OAuth (token IGDB) a répondu ${res.status}`);
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
  lancoopmax?: number;
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
    process.env.IGDB_CLIENT_ID!,
  ];

  const res = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: `search "${term}"; fields name,cover.image_id,multiplayer_modes.campaigncoop,multiplayer_modes.onlinecoopmax,multiplayer_modes.offlinecoopmax,multiplayer_modes.lancoopmax,multiplayer_modes.onlinemax,multiplayer_modes.offlinemax; limit 8;`,
  });

  if (!res.ok) {
    throw new Error(`IGDB a répondu ${res.status}`);
  }

  const games = (await res.json()) as IgdbGameResponse[];

  return games.map((game) => {
    const modes = game.multiplayer_modes ?? [];

    const isCoop = modes.some(
      (m) =>
        m.campaigncoop ||
        (m.onlinecoopmax ?? 0) > 0 ||
        (m.offlinecoopmax ?? 0) > 0 ||
        (m.lancoopmax ?? 0) > 0
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
