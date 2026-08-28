import type { GameSource } from "@prisma/client";
import type { IgdbGameDetails } from "@/lib/igdb";

/**
 * Filtres de bibliothèque style Steam (PR 31, 2/4 — Bloc B), partagés
 * entre `/bibliotheque`, `/bibliotheque/groupe` et `/tierlist`. Filtrage
 * en deux temps plutôt qu'une seule requête Prisma :
 * - Colonnes Prisma directes (source, `minPlayers`/`maxPlayers`) → `where`
 *   pourrait marcher, mais pour rester simple et cohérent avec le filtre
 *   "possédé par N potes" (qui a de toute façon besoin d'un comptage
 *   séparé) et les filtres dépendant d'`igdbDetails` (JSON, cf.
 *   ci-dessous), tout le monde passe par la même fonction
 *   `matchesGameFilters` appliquée en mémoire après une requête Prisma
 *   simple (`findMany` sans `where` complexe) — une biblio de groupe
 *   d'amis reste petite (quelques centaines de jeux au pire), le filtrage
 *   JS est largement assez rapide et évite la syntaxe fragile des
 *   requêtes JSON Prisma (`path`/`array_contains`, sensible à la version).
 * - Genre et date de sortie dépendent d'`igdbDetails` (cache JSON, rempli
 *   à la demande au premier clic sur la fiche jeu — jamais en masse, cf.
 *   PR "fiche jeu"). Un jeu sans cache ne matche jamais ces deux
 *   filtres tant qu'il n'a pas été enrichi (stratégie "Option B",
 *   documentée dans le README) — c'est un choix assumé, pas un bug.
 */

export const GAME_MODES = ["solo", "multi", "coop", "local"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  solo: "Solo",
  multi: "Multijoueur",
  coop: "Coop",
  local: "Local",
};

export const GAME_SOURCES: GameSource[] = ["STEAM", "MANUAL", "IGDB"];

export const GAME_SOURCE_LABELS: Record<GameSource, string> = {
  STEAM: "Steam",
  MANUAL: "Manuel",
  IGDB: "IGDB",
};

export const PLAYERS_RANGE = { min: 1, max: 100 };
export const RELEASE_YEAR_RANGE = { min: 1990, max: 2026 };

/**
 * "Local" n'a pas de champ dédié en base ni dans le cache IGDB actuel
 * (`game_modes` n'est pas fetché par `fetchIgdbGameDetails` — l'ajouter
 * pour ce seul filtre aurait élargi le scope déjà large de cette PR pour
 * un gain marginal). Approximé à partir de `maxPlayers` : un jeu
 * multijoueur avec un petit nombre de joueurs max (typiquement "salon/
 * canapé") plutôt qu'une vraie détection de mode. Documenté comme une
 * heuristique, pas une donnée exacte.
 */
const LOCAL_MODE_MAX_PLAYERS = 8;

/**
 * Genres IGDB (noms canoniques, en anglais) → libellé FR, pour les plus
 * courants dans une bibliothèque de jeux grand public. Repli sur le nom
 * IGDB brut si absent de cette table — la liste des genres proposée au
 * filtre est de toute façon dynamique (dérivée des jeux réellement
 * présents, cf. `collectAvailableGenres`), jamais une liste FR fixe
 * déconnectée des vraies données : certaines catégories évoquées dans la
 * demande initiale (Action, Casual, MMO) ne sont d'ailleurs pas des
 * `genres` IGDB au sens strict (Action n'existe pas comme genre IGDB,
 * MMO est un `game_mode`) — un filtre qui ne matcherait jamais rien
 * serait pire qu'un filtre fidèle aux données réelles.
 */
const GENRE_LABELS_FR: Record<string, string> = {
  "Role-playing (RPG)": "RPG",
  Shooter: "Tir",
  Strategy: "Stratégie",
  "Turn-based strategy (TBS)": "Stratégie (tour par tour)",
  "Real Time Strategy (RTS)": "Stratégie (temps réel)",
  Simulator: "Simulation",
  Sport: "Sport",
  Racing: "Course",
  Adventure: "Aventure",
  Indie: "Indépendant",
  Puzzle: "Réflexion",
  Fighting: "Combat",
  Platform: "Plateforme",
  Arcade: "Arcade",
  "Hack and slash/Beat 'em up": "Beat'em up",
  Tactical: "Tactique",
  "Card & Board Game": "Carte & plateau",
  "Visual Novel": "Visual Novel",
  "Point-and-click": "Pointer-cliquer",
  Music: "Musique",
  Pinball: "Flipper",
  "Quiz/Trivia": "Quiz",
  MOBA: "MOBA",
};

export function translateGenre(igdbGenre: string): string {
  return GENRE_LABELS_FR[igdbGenre] ?? igdbGenre;
}

export interface FilterableGame {
  id: string;
  source: GameSource;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Cast `as unknown as IgdbGameDetails` par l'appelant — cf. `src/lib/game-details.ts` pour le même pattern déjà établi sur `Game.igdbDetails` (`Json?` en base). */
  igdbDetails: Pick<IgdbGameDetails, "genres" | "releaseDate"> | null;
}

export interface GameFilters {
  modes: GameMode[];
  playersMin: number;
  playersMax: number;
  sources: GameSource[];
  /** "Possédé par au moins N potes" — 1 = pas de filtre actif (tout jeu possédé a au moins 1 possesseur). */
  ownedMin: number;
  /** Libellés FR déjà traduits (cf. `translateGenre`). */
  genres: string[];
  yearMin: number;
  yearMax: number;
}

export const DEFAULT_GAME_FILTERS: GameFilters = {
  modes: [],
  playersMin: PLAYERS_RANGE.min,
  playersMax: PLAYERS_RANGE.max,
  sources: [],
  ownedMin: 1,
  genres: [],
  yearMin: RELEASE_YEAR_RANGE.min,
  yearMax: RELEASE_YEAR_RANGE.max,
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseListParam(value: string | string[] | undefined): string[] {
  const raw = firstValue(value);
  return raw ? raw.split(",").filter(Boolean) : [];
}

function clampNumber(
  raw: string | string[] | undefined,
  fallback: number,
  range: { min: number; max: number }
): number {
  const n = Number(firstValue(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

/** Lit les filtres depuis les `searchParams` d'une page (Next.js App Router). */
export function parseGameFilters(
  searchParams: Record<string, string | string[] | undefined>
): GameFilters {
  const modes = parseListParam(searchParams.modes).filter((m): m is GameMode =>
    (GAME_MODES as readonly string[]).includes(m)
  );
  const sources = parseListParam(searchParams.sources).filter((s): s is GameSource =>
    (GAME_SOURCES as readonly string[]).includes(s)
  );

  return {
    modes,
    playersMin: clampNumber(searchParams.playersMin, PLAYERS_RANGE.min, PLAYERS_RANGE),
    playersMax: clampNumber(searchParams.playersMax, PLAYERS_RANGE.max, PLAYERS_RANGE),
    sources,
    ownedMin: clampNumber(searchParams.ownedMin, 1, { min: 1, max: 999 }),
    genres: parseListParam(searchParams.genres),
    yearMin: clampNumber(searchParams.yearMin, RELEASE_YEAR_RANGE.min, RELEASE_YEAR_RANGE),
    yearMax: clampNumber(searchParams.yearMax, RELEASE_YEAR_RANGE.max, RELEASE_YEAR_RANGE),
  };
}

/** Sérialise les filtres actifs en query string (`?modes=coop&genres=RPG,Aventure`) — filtres inactifs omis. */
export function serializeGameFilters(filters: GameFilters): string {
  const params = new URLSearchParams();
  if (filters.modes.length > 0) params.set("modes", filters.modes.join(","));
  if (filters.playersMin !== PLAYERS_RANGE.min) params.set("playersMin", String(filters.playersMin));
  if (filters.playersMax !== PLAYERS_RANGE.max) params.set("playersMax", String(filters.playersMax));
  if (filters.sources.length > 0) params.set("sources", filters.sources.join(","));
  if (filters.ownedMin > 1) params.set("ownedMin", String(filters.ownedMin));
  if (filters.genres.length > 0) params.set("genres", filters.genres.join(","));
  if (filters.yearMin !== RELEASE_YEAR_RANGE.min) params.set("yearMin", String(filters.yearMin));
  if (filters.yearMax !== RELEASE_YEAR_RANGE.max) params.set("yearMax", String(filters.yearMax));
  return params.toString();
}

export function countActiveFilters(filters: GameFilters): number {
  let count = 0;
  if (filters.modes.length > 0) count++;
  if (filters.playersMin !== PLAYERS_RANGE.min || filters.playersMax !== PLAYERS_RANGE.max) count++;
  if (filters.sources.length > 0) count++;
  if (filters.ownedMin > 1) count++;
  if (filters.genres.length > 0) count++;
  if (filters.yearMin !== RELEASE_YEAR_RANGE.min || filters.yearMax !== RELEASE_YEAR_RANGE.max) count++;
  return count;
}

function gameModesFor(game: FilterableGame): GameMode[] {
  const modes: GameMode[] = [];
  if (game.maxPlayers === 1) modes.push("solo");
  if (game.maxPlayers === null || game.maxPlayers > 1) modes.push("multi");
  if (game.isCoop) modes.push("coop");
  if (
    game.maxPlayers !== null &&
    game.maxPlayers > 1 &&
    game.maxPlayers <= LOCAL_MODE_MAX_PLAYERS
  ) {
    modes.push("local");
  }
  return modes;
}

/**
 * Liste des genres réellement présents dans une liste de jeux (déjà
 * traduits FR, triés, dédupliqués) — options dynamiques du filtre Genre,
 * jamais une liste fixe déconnectée des données.
 */
export function collectAvailableGenres(games: FilterableGame[]): string[] {
  const set = new Set<string>();
  for (const game of games) {
    for (const genre of game.igdbDetails?.genres ?? []) {
      set.add(translateGenre(genre));
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

export function matchesGameFilters(
  game: FilterableGame,
  ownerCount: number,
  filters: GameFilters
): boolean {
  if (filters.modes.length > 0) {
    const modes = gameModesFor(game);
    if (!filters.modes.some((m) => modes.includes(m))) return false;
  }

  if (filters.playersMin > PLAYERS_RANGE.min || filters.playersMax < PLAYERS_RANGE.max) {
    if (game.minPlayers === null || game.maxPlayers === null) return false;
    if (game.maxPlayers < filters.playersMin || game.minPlayers > filters.playersMax) {
      return false;
    }
  }

  if (filters.sources.length > 0 && !filters.sources.includes(game.source)) return false;

  if (filters.ownedMin > 1 && ownerCount < filters.ownedMin) return false;

  if (filters.genres.length > 0) {
    const genres = (game.igdbDetails?.genres ?? []).map(translateGenre);
    if (!filters.genres.some((g) => genres.includes(g))) return false;
  }

  if (filters.yearMin > RELEASE_YEAR_RANGE.min || filters.yearMax < RELEASE_YEAR_RANGE.max) {
    const releaseDate = game.igdbDetails?.releaseDate;
    if (!releaseDate) return false;
    const year = new Date(releaseDate).getUTCFullYear();
    if (year < filters.yearMin || year > filters.yearMax) return false;
  }

  return true;
}
