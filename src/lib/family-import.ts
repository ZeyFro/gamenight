/**
 * Import "biblio Steam Family" par copier-coller (PR "Import biblio Steam
 * Family via copier-coller"). Steam ne permet à aucune app tierce
 * d'accéder automatiquement à une bibliothèque familiale partagée : les
 * deux endpoints qui exposeraient cette donnée (`IFamilyGroupsService/
 * GetFamilyGroupForUser` et `GetSharedLibraryApps`) exigent un
 * `access_token` de session Steam personnelle (récupéré depuis un
 * navigateur connecté à Steam), pas une clé Web API serveur comme
 * `STEAM_API_KEY` — aucun moyen pour GameNight de l'obtenir pour un
 * utilisateur sans lui demander de coller un token à chaque expiration.
 * Le client Steam lui-même n'expose la liste "Famille" que dans son
 * interface (groupée par membre), pas sur une page web copiable au
 * Ctrl+A/Ctrl+C. D'où l'alternative : l'utilisateur colle une liste de
 * noms de jeux (peu importe la source réelle — famille, mémoire, notes),
 * l'app fait le reste (recherche IGDB + import).
 *
 * Ce module est pure logique (parsing + scoring), sans accès Prisma ni
 * réseau — `src/app/profil/family-import-actions.ts` orchestre les
 * appels IGDB (`searchIgdbGames`) et les écritures en base.
 */

import { searchIgdbGames, type IgdbGameCandidate } from "@/lib/igdb";
import { logger } from "@/lib/logger";

/**
 * En dessous de ce score de similarité (0–1), un résultat IGDB n'est pas
 * assez fiable pour être importé automatiquement — direction "à
 * confirmer" plutôt qu'un mauvais match silencieux. 85% tolère les
 * variations mineures usuelles (ponctuation, article manquant, tiret vs
 * espace) tout en filtrant les faux positifs sur un nom trop générique
 * (ex. "DOOM" vs "DOOM Eternal" ne devrait pas matcher automatiquement).
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.85;

/** Nombre de candidats traités par lot côté client (voir `FamilyImportForm.tsx`) — même ordre de grandeur que suggéré (10–20), avec le délai de `searchIgdbGames` (token Twitch caché, pas de délai artificiel ajouté ici : IGDB tolère largement ce débit). */
export const FAMILY_IMPORT_BATCH_SIZE = 15;

/** Plafonds d'un import collé : nombre de noms au total, et longueur d'un nom (au-delà : jamais cherché, à confirmer à la main). */
export const FAMILY_IMPORT_MAX_NAMES = 500;
export const FAMILY_IMPORT_MAX_NAME_LENGTH = 100;

function normalizeGameName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritiques (é → e, etc.)
    .replace(/[™®©:!?'’"()[\]]/g, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distance de Levenshtein classique (programmation dynamique, complexité O(n·m)) — noms de jeux courts, coût négligeable. */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array<number>(cols - 1).fill(0),
  ]);
  for (let j = 1; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

/** Similarité 0–1 entre deux noms de jeux, après normalisation (casse, accents, ponctuation). 1 = identiques. */
export function stringSimilarity(a: string, b: string): number {
  const normA = normalizeGameName(a);
  const normB = normalizeGameName(b);
  if (normA === normB) return 1;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(normA, normB) / maxLen;
}

/** Ligne qui ressemble à une date, un nombre (durée de jeu, timestamp…) ou une URL — jamais un nom de jeu. */
function looksLikeNoise(line: string): boolean {
  if (/^https?:\/\//i.test(line) || /^www\./i.test(line)) return true;
  // Pure ponctuation/chiffres (dates, "42.3 hrs on record" sans lettres, etc.)
  if (/^[\d.,:/\s-]+$/.test(line)) return true;
  return false;
}

/**
 * Parse le texte collé en une liste de noms de jeux candidats. Format
 * supporté : un nom par ligne, et/ou plusieurs noms séparés par des
 * virgules sur une même ligne — tolérant sur le mélange des deux. Ne
 * tente pas de parser une page Steam complète collée telle quelle (avec
 * durées de jeu, dates de dernière session, etc. entremêlées sur la même
 * ligne qu'un nom) : seules les lignes reconnues comme du "bruit" pur
 * (nombres/dates/URLs) sont filtrées, pas un vrai nettoyage ligne par
 * ligne — limite assumée et documentée dans le README plutôt qu'un
 * parseur HTML/DOM impossible à écrire pour du texte brut collé.
 */
export function parseGameNamesFromText(text: string): string[] {
  const candidates = text
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((raw) => raw.trim())
    .filter((name) => name.length >= 2 && !looksLikeNoise(name));

  // Déduplication insensible à la casse, en gardant la 1ère casse rencontrée.
  const seen = new Map<string, string>();
  for (const name of candidates) {
    const key = normalizeGameName(name);
    if (!seen.has(key)) seen.set(key, name);
  }
  return Array.from(seen.values()).slice(0, FAMILY_IMPORT_MAX_NAMES);
}

export type FamilyMatchStatus = "matched" | "needsConfirmation";

export interface FamilyMatchResult {
  input: string;
  status: FamilyMatchStatus;
  /** Meilleur candidat IGDB trouvé, même si sous le seuil (utile pour préremplir la confirmation manuelle). */
  candidate: IgdbGameCandidate | null;
  confidence: number;
}

/**
 * Cherche le meilleur candidat IGDB pour un nom donné et calcule sa
 * confiance. Ne fait aucune écriture ni vérification de doublon — pur
 * appel réseau + scoring, à charge de l'appelant (`matchFamilyImportBatch`)
 * de décider quoi faire du résultat.
 */
export async function matchGameName(input: string): Promise<FamilyMatchResult> {
  let candidates: IgdbGameCandidate[] = [];
  try {
    candidates = await searchIgdbGames(input);
  } catch (error) {
    logger.error("family-import", error, { input });
  }

  if (candidates.length === 0) {
    logger.info("family-import", `Recherche "${input}"... aucun résultat IGDB.`);
    return { input, status: "needsConfirmation", candidate: null, confidence: 0 };
  }

  const scored = candidates
    .map((candidate) => ({ candidate, confidence: stringSimilarity(input, candidate.name) }))
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  const status: FamilyMatchStatus =
    best.confidence >= MATCH_CONFIDENCE_THRESHOLD ? "matched" : "needsConfirmation";

  logger.info(
    "family-import",
    `Recherche "${input}"... trouvé "${best.candidate.name}" (confiance ${Math.round(best.confidence * 100)}%) → ${status === "matched" ? "importé" : "à confirmer"}`
  );

  return { input, status, candidate: best.candidate, confidence: best.confidence };
}
