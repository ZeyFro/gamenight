/**
 * Actu gaming (Sprint 3) — `ISteamNews/GetNewsForApp`, endpoint public de
 * l'API Steam qui n'exige pas de clé (contrairement à
 * `GetOwnedGames`/`src/lib/steam.ts`) : rien à ajouter à `.env.example`.
 */

const STEAM_NEWS_ENDPOINT = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";
const NEWS_COUNT = 3;
const NEWS_MAX_LENGTH = 200;

export interface SteamNewsItem {
  title: string;
  url: string;
  feedLabel: string;
  publishedAt: Date;
}

interface SteamNewsApiResponse {
  appnews?: {
    newsitems?: Array<{
      title: string;
      url: string;
      feedlabel: string;
      date: number;
    }>;
  };
}

export async function fetchGameNews(steamAppId: number): Promise<SteamNewsItem[]> {
  const url = new URL(STEAM_NEWS_ENDPOINT);
  url.searchParams.set("appid", String(steamAppId));
  url.searchParams.set("count", String(NEWS_COUNT));
  url.searchParams.set("maxlength", String(NEWS_MAX_LENGTH));
  url.searchParams.set("format", "json");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Steam GetNewsForApp a répondu ${res.status}`);
  }

  const data = (await res.json()) as SteamNewsApiResponse;
  const items = data.appnews?.newsitems ?? [];

  return items
    .filter((item) => item.title && item.url)
    .map((item) => ({
      title: item.title,
      url: item.url,
      feedLabel: item.feedlabel,
      publishedAt: new Date(item.date * 1000),
    }));
}
