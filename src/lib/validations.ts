import { z } from "zod";

/**
 * Schémas zod pour les server actions qui acceptent des données
 * utilisateur (Sprint 1, fiabilisation — chantier "Validation entrées
 * serveur"). Chaque action ciblée appelle `schema.safeParse()` en tout
 * premier, avant toute lecture Prisma — jamais de `throw` : un échec de
 * validation retourne une erreur propre, dans la même convention que
 * chaque action utilisait déjà pour ses autres cas d'échec (redirect
 * `?error=...` pour les formulaires bruts, `{ ok: false, error }` pour les
 * actions déjà pilotées côté client).
 *
 * Répartition volontaire entre ce que valide zod et ce qui reste dans la
 * logique métier existante :
 * - zod valide la FORME (un identifiant est une chaîne non vide, une date
 *   respecte "YYYY-MM-DD", une heure "HH:mm", une couleur "#RRGGBB"...) —
 *   c'est un filtre contre les données malformées/manipulées, pas une
 *   deuxième source de vérité pour les règles métier.
 * - Les règles métier qui dépendent de l'état actuel (deadline avant/après
 *   la session, session pas trop proche, override qui traverse minuit...)
 *   restent dans `resolveSessionSchedule`/`isAvailableAt`/etc. — déjà
 *   testées (chantier "Tests automatisés"), déjà correctes, et dupliquer
 *   ces règles dans un schéma zod séparé serait une nouvelle source de
 *   désaccord plutôt qu'une protection supplémentaire.
 *
 * Écart assumé par rapport à l'énoncé : `upsertOverride`/`addWeeklySlot`
 * ne valident PAS `startTime < endTime` en dur — `isAvailableAt`
 * (`src/lib/availability.ts`) supporte explicitement un créneau qui
 * traverse minuit (ex. 21:00–00:00, ou 23:00–02:00) en interprétant
 * `endTime <= startTime` comme "jusqu'à minuit puis de minuit à endTime".
 * Imposer `startTime < endTime` casserait cette fonctionnalité existante
 * et couverte par PR #1-46 (zéro régression) — zod valide donc uniquement
 * le format `HH:mm` des deux champs, la sémantique de l'ordre reste celle,
 * déjà correcte, d'`isAvailableAt`.
 */

/** Clé/message génériques réutilisés par les actions qui redirigent avec `?error=...` (mêmes conventions que `RATE_LIMIT_ERROR_KEY`/`RATE_LIMIT_MESSAGE`). */
export const VALIDATION_ERROR_KEY = "donnees_invalides";
export const VALIDATION_ERROR_MESSAGE =
  "Certaines informations saisies ne sont pas valides. Vérifie le formulaire et réessaie.";

export const idSchema = z
  .string()
  .trim()
  .min(1, "Identifiant manquant.");

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");

export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (format HH:mm attendu).");

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format #RRGGBB attendu).");

export const httpUrlSchema = z
  .string()
  .regex(/^https?:\/\//i, "URL invalide (doit commencer par http:// ou https://).");

/** `createSession` — date/heure de session, sélection de destinataires du ping Discord. */
export const createSessionSchema = z.object({
  date: dateStringSchema,
  time: timeStringSchema,
  notifyUserIds: z.array(idSchema),
});

/** `editSessionAction` — mêmes contraintes de forme que la création. */
export const editSessionSchema = z.object({
  sessionId: idSchema,
  date: dateStringSchema,
  time: timeStringSchema,
  deadlineDate: dateStringSchema,
  deadlineTime: timeStringSchema,
});

/** `proposeGame` / `withdrawProposalAction` — identifiants de session + jeu ou proposition. */
export const sessionGameRefSchema = z.object({
  sessionId: idSchema,
  gameId: idSchema,
});

export const sessionProposalRefSchema = z.object({
  sessionId: idSchema,
  proposalId: idSchema,
});

/** `toggleVote` (castVote) — l'auteur du vote est toujours `getCurrentUser()`, jamais lu depuis `formData`. */
export const toggleVoteSchema = sessionProposalRefSchema;

/** `submitSuperlativeVotesAction` (castSuperlativeVote) — un vote par catégorie active, formulaire tout-ou-rien. */
export const superlativeVoteEntrySchema = z.object({
  categoryId: idSchema,
  votedForUserId: idSchema,
});

/** `addWeeklySlot` — créneau hebdomadaire récurrent. */
export const weeklySlotSchema = z.object({
  dayOfWeek: z
    .number()
    .int()
    .min(0, "Jour de la semaine invalide.")
    .max(6, "Jour de la semaine invalide."),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
});

/** `upsertOverride` — exception ponctuelle, horaires optionnels (journée entière si absents). */
export const overrideSchema = z.object({
  date: dateStringSchema,
  available: z.boolean(),
  startTime: z.union([timeStringSchema, z.literal("")]),
  endTime: z.union([timeStringSchema, z.literal("")]),
});

/** `removeOverrideForDate` — édition tactile depuis `/calendrier`. */
export const overrideDateRefSchema = z.object({
  date: dateStringSchema,
});

/** `updateUserColor` — couleur perso, palette ou saisie hex libre. */
export const userColorSchema = z.object({
  color: hexColorSchema,
});

/** `setBannerUrlAction` — vide = retour à la bannière par défaut, sinon URL http(s). */
export const bannerUrlSchema = z.object({
  bannerUrl: z.union([httpUrlSchema, z.literal("")]),
});

export const PLAYER_COUNT_ERROR_MESSAGE =
  "Le nombre de joueurs minimum doit être entre 1 et 100, et le maximum (si renseigné) doit être supérieur ou égal au minimum.";

/** Min/max joueurs — même règle réutilisée par `addManualGame` et `updateGame` (déjà appliquée par les deux avant ce chantier, formalisée ici en un seul schéma partagé). */
export const playerCountsSchema = z
  .object({
    minPlayers: z.number().int().min(1).max(100),
    maxPlayers: z.number().int().min(1).max(100).nullable(),
  })
  .refine((data) => data.maxPlayers === null || data.maxPlayers >= data.minPlayers, {
    message: PLAYER_COUNT_ERROR_MESSAGE,
    path: ["maxPlayers"],
  });

/**
 * `addManualGame` (createGame) — nom non vide, `igdbId` numérique s'il est
 * fourni. Séparé de `playerCountsSchema` (utilisé à côté, dans l'action)
 * plutôt que fusionné dans un seul schéma : un nom vide et un nombre de
 * joueurs invalide sont deux erreurs distinctes qui redirigent vers deux
 * `?error=...` différents (comportement déjà établi avant ce chantier),
 * les regrouper aurait affiché le mauvais message pour l'une des deux
 * causes. Le formulaire manuel n'a pas de champ `steamAppId` (réservé aux
 * jeux importés depuis Steam, jamais saisis à la main) : le seul
 * identifiant externe optionnel saisissable ici est `igdbId`.
 */
export const addManualGameSchema = z.object({
  name: z.string().trim().min(1, "Le nom du jeu ne peut pas être vide."),
  igdbId: z.union([
    z.string().regex(/^\d+$/, "L'identifiant IGDB doit être numérique."),
    z.literal(""),
  ]),
});

/**
 * `updateGame` — édition d'un jeu déjà en bibliothèque : `gameId`
 * (`idSchema`) + `playerCountsSchema` ci-dessus, validés séparément dans
 * l'action. `name` n'est PAS schématisé ici : sa validation ("requis
 * seulement si `source = MANUAL`") dépend du jeu chargé depuis la DB, donc
 * reste dans l'action elle-même après ce premier filtre de forme, comme
 * pour tout le reste des règles métier (cf. le commentaire en tête de
 * fichier).
 */
