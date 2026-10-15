/**
 * Client Steam Store API (endpoint public, sans clé) — PR 32.6, Bloc A.
 * Complète le backfill IGDB (PR 32/2.5) : IGDB n'a pas les données de
 * TOUS les jeux, Steam Store si (chaque jeu Steam a forcément une fiche
 * store). Priorité de source assumée : Steam Store > IGDB > défaut —
 * appliquée par SÉQUENCEMENT des scripts de build (`backfill-coop.mjs`
 * pour IGDB tourne avant `backfill-steam-coop.mjs`), pas par une logique
 * de comparaison ici : ce module ne connaît que Steam Store.
 *
 * Duplication assumée (même philosophie que `src/lib/igdb.ts` /
 * `prisma/backfill-coop.mjs`) : la logique de dérivation `isCoop` ci-
 * dessous est reprise telle quelle dans `prisma/backfill-steam-coop.mjs`
 * (script Node/ESM autonome, pas d'accès aux alias `@/...`). À GARDER EN
 * SYNC si la liste d'ids/mots-clés change.
 */

export interface SteamStoreCategory {
  id: number;
  description: string;
}

export interface SteamStoreDetails {
  categories: SteamStoreCategory[];
  isCoop: boolean;
  // Sprint 5 (Wishlist) — prix affiché tel quel par Steam ("19,99€",
  // déjà formaté FR via `?l=french`), `null` si le jeu est gratuit ou si
  // Steam n'a pas renvoyé de `price_overview` (jeu retiré du store,
  // région sans prix…) — "approximatif" et best-effort, cf. spec.
  priceFormatted: string | null;
  isFree: boolean | null;
  priceCurrency: string | null;
}

/**
 * Erreur HTTP Steam Store avec le status attaché — permet à l'appelant
 * (`src/lib/backfill-steam-coop.ts`) de distinguer un 429 (rate limit,
 * doit arrêter la boucle proprement) d'une autre erreur (log, jeu suivant).
 */
export class SteamStoreHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SteamStoreHttpError";
  }
}

/**
 * Ids de catégories Steam connus pour indiquer du coop (stables,
 * indépendants de la langue — contrairement à `description`, localisée
 * par `?l=french` et donc pas fiable seule pour matcher dans toutes les
 * langues). Detection à double sécurité : id ET mots-clés sur la
 * description (ci-dessous), au cas où la taxonomie Steam ait changé ou
 * qu'un id soit mal documenté.
 */
const COOP_CATEGORY_IDS = new Set([9, 24, 27, 38, 39, 48]);

const COOP_KEYWORDS = ["coop", "co-op", "coopératif", "écran partagé", "partagé"];

export function deriveIsCoopFromCategories(categories: SteamStoreCategory[]): boolean {
  return categories.some(
    (c) =>
      COOP_CATEGORY_IDS.has(c.id) ||
      COOP_KEYWORDS.some((kw) => c.description.toLowerCase().includes(kw))
  );
}

/**
 * `null` = pas de données exploitables (appid inconnu côté Steam, jeu
 * retiré du store…) — à distinguer d'une erreur réseau/HTTP, qui lève
 * une exception (à charge de l'appelant de décider quoi en faire, même
 * convention que `fetchIgdbGameDetails`).
 */
export async function fetchSteamStoreDetails(
  steamAppId: number,
  options?: { signal?: AbortSignal }
): Promise<SteamStoreDetails | null> {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${steamAppId}&l=french&cc=fr`,
    { signal: options?.signal }
  );
  if (!res.ok) {
    throw new SteamStoreHttpError(
      res.status,
      `Steam Store (appid ${steamAppId}) a répondu ${res.status}`
    );
  }

  const body = (await res.json()) as Record<
    string,
    {
      success: boolean;
      data?: {
        categories?: SteamStoreCategory[];
        is_free?: boolean;
        price_overview?: { final_formatted?: string; currency?: string };
      };
    }
  >;
  const entry = body[String(steamAppId)];
  if (!entry?.success || !entry.data) return null;

  const categories = entry.data.categories ?? [];
  const isFree = typeof entry.data.is_free === "boolean" ? entry.data.is_free : null;
  const rawPrice = entry.data.price_overview?.final_formatted;
  const rawCurrency = entry.data.price_overview?.currency;
  const priceFormatted = isFree === true
    ? null
    : (typeof rawPrice === "string" && rawPrice.trim().length > 0 && rawPrice.length <= 120 ? rawPrice : null);
  const priceCurrency = typeof rawCurrency === "string" && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
  return { categories, isCoop: deriveIsCoopFromCategories(categories), priceFormatted, isFree, priceCurrency };
}
