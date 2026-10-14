import { findBannerUrlProblem } from "@/lib/banner-url";
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

/**
 * `toggleVote` (castVote) — PAS de `sessionId` (contrairement à
 * `sessionProposalRefSchema` ci-dessus) : fix bug remonté (vote
 * inter-session) — le client ne fournit plus qu'un `proposalId`, la
 * session est dérivée server-side depuis `Proposal.sessionId` (voir
 * `toggleVote`), jamais depuis une valeur transmise par le navigateur.
 * L'auteur du vote est lui aussi toujours `getCurrentUser()`, jamais lu
 * depuis `formData`.
 */
export const toggleVoteSchema = z.object({
  proposalId: idSchema,
});

/** `submitSuperlativeVotesAction` (castSuperlativeVote) — un vote par catégorie active, formulaire tout-ou-rien. */
export const superlativeVoteEntrySchema = z.object({
  categoryId: idSchema,
  votedForUserId: idSchema,
});

/** Sprint 4 (Pronostics) — `submitPronosticAction`. */
export const pronosticSchema = z.object({
  sessionId: idSchema,
  predictedUserId: idSchema,
});

/** Sprint 4 (Paris d'XP) — `placeBetAction`. Bornes réelles (10-50% du solde, tranches de 10) revalidées dans `isValidBetAmount` (src/lib/xp-bets.ts), zod ne garantit ici que la forme (entier positif). */
export const xpBetSchema = z.object({
  sessionId: idSchema,
  targetUserId: idSchema,
  amount: z.coerce.number().int().positive(),
});

/** Sprint 5 (Tournois Bracket) — `createTournamentAction`. `maxPlayers` limité à {4, 6, 8} (cf. `bracketSizeFor`, src/lib/tournaments.ts). */
export const createTournamentSchema = z.object({
  name: z.string().trim().min(1, "Nom manquant.").max(60, "Nom trop long (max 60 caractères)."),
  gameId: idSchema,
  maxPlayers: z.coerce.number().int().refine((n) => [4, 6, 8].includes(n), "4, 6 ou 8 joueurs uniquement."),
});

/** Sprint 5 (Tournois Bracket) — `declareWinnerAction`. */
// Scores optionnels : champ vide = absent ; les deux ensemble ou aucun.
const optionalScore = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().int().min(0).max(999).optional()
);
export const declareWinnerSchema = z
  .object({ matchId: idSchema, winnerId: idSchema, score1: optionalScore, score2: optionalScore })
  .refine((d) => (d.score1 === undefined) === (d.score2 === undefined), {
    message: "Renseigne les deux scores ou aucun.",
    path: ["score1"],
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
  bannerUrl: z
    .union([httpUrlSchema, z.literal("")])
    .superRefine((value, ctx) => {
      const problem = findBannerUrlProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
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
/** `createSessionFromRouletteAction` — jeu gagnant + créneau + participants. */
export const createRouletteSessionSchema = z.object({
  gameId: idSchema,
  date: dateStringSchema,
  time: timeStringSchema,
  participantIds: z.array(idSchema).min(2, "Il faut au moins 2 participants."),
});

/** `createRouletteAction` (roulette asynchrone) — créneau + participants invités. */
export const createRouletteSchema = z.object({
  date: dateStringSchema,
  time: timeStringSchema,
  deadlineOffset: z.string().regex(/^\d+(\.\d+)?$/, "Délai invalide."),
  participantIds: z.array(idSchema),
});

/** `submitRouletteEntriesAction` — exactement 2 jeux distincts proposés. */
export const submitRouletteEntriesSchema = z.object({
  rouletteId: idSchema,
  gameIds: z
    .array(idSchema)
    .length(2, "Il faut proposer exactement 2 jeux.")
    .refine((ids) => new Set(ids).size === 2, "Les 2 jeux doivent être différents."),
});

/** `createTagAction` — nom de tag libre, court (chip UI). */
export const tagNameSchema = z.object({
  name: z.string().trim().min(1, "Le nom du tag ne peut pas être vide.").max(24, "24 caractères max."),
});

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

/** `setDebtGageAction` (Sprint 3 suite, dettes/gage) — texte libre saisi par le créateur. */
export const setDebtGageSchema = z.object({
  debtId: idSchema,
  gage: z.string().trim().min(1, "Le gage ne peut pas être vide.").max(200, "200 caractères max."),
});

/** Sprint 5 (Chat in-app) — `sendChatMessageAction`. `sessionId` absent/vide = canal global. */
export const sendChatMessageSchema = z.object({
  content: z.string().trim().min(1, "Message vide.").max(500, "500 caractères max."),
  sessionId: z.union([idSchema, z.literal("")]),
});

/** Sprint 5 (Chat in-app) — `toggleReactionAction`. 4 emojis fixes (cf. spec), pas de saisie libre. */
export const CHAT_REACTION_EMOJIS = ["👍", "😂", "🔥", "💀"] as const;
export const toggleReactionSchema = z.object({
  messageId: idSchema,
  emoji: z.enum(CHAT_REACTION_EMOJIS),
});

/**
 * Fix (Sprint 5 suite) — `proposeWishlistGameAction`. La wishlist doit
 * pouvoir proposer un jeu que PERSONNE ne possède encore (ex. un jeu pas
 * encore sorti) : recherche IGDB plutôt qu'un select limité à la biblio
 * du groupe, `igdbId` obligatoire (même logique que l'ajout manuel,
 * `addManualGameSchema` — le jeu est upsert par `igdbId`, cf.
 * `proposeWishlistGameAction`). `reason` optionnel.
 */
export const proposeWishlistGameSchema = z.object({
  igdbId: z.string().regex(/^\d+$/, "Identifiant IGDB invalide."),
  name: z.string().trim().min(1, "Nom manquant.").max(200, "200 caractères max."),
  coverUrl: z.union([httpUrlSchema, z.literal("")]),
  reason: z.union([z.string().trim().max(200, "200 caractères max."), z.literal("")]),
});

/** Sprint 5 (Wishlist) — `voteWishlistAction`. */
export const voteWishlistSchema = z.object({
  wishlistId: idSchema,
  interested: z.enum(["true", "false"]),
});

/**
 * `resolveIgdbGameAction` (sélecteur de jeu, création de tournoi) — upsert
 * minimal d'un candidat IGDB choisi. Mêmes contraintes de forme que
 * `proposeWishlistGameSchema`, sans `reason` (pas de champ équivalent
 * dans ce flux).
 */
export const resolveIgdbGameSchema = z.object({
  igdbId: z.string().regex(/^\d+$/, "Identifiant IGDB invalide."),
  name: z.string().trim().min(1, "Nom manquant.").max(200, "200 caractères max."),
  coverUrl: z.union([httpUrlSchema, z.literal("")]),
});

/** V2 ("Jouer maintenant") — `createInstantSessionAction`. */
export const createInstantSessionSchema = z.object({
  gameId: idSchema,
  notifyUserIds: z.array(idSchema),
});

/** `changeInstantSessionGameAction`. */
export const changeInstantSessionGameSchema = z.object({
  instantSessionId: idSchema,
  gameId: idSchema,
});
