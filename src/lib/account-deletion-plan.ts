/**
 * Suppression de compte (ACCOUNT_DELETION_ENABLED, docs/SUPPRESSION_COMPTE.md) : classement de CHAQUE relation
 * qui pointe vers `User` dans `prisma/schema.prisma`. Module PUR (aucun accès base) : lu par l'exécuteur
 * (`account-deletion.ts`) ET par le test `account-deletion-plan.test.ts`, qui échoue si une relation ou un
 * champ-identifiant du schéma n'est pas classé ici.
 *
 * Principe : la ligne `User` n'est JAMAIS supprimée (les clés étrangères des contenus collectifs, en
 * Restrict pour 14 d'entre elles, l'interdisent). Elle devient un compte anonymisé « Ancien membre » (sans
 * identifiant Discord, nom, avatar, jetons, plateformes), sans Membership, donc invisible partout. Chaque
 * relation est ensuite soit SUPPRIMÉE (donnée personnelle de la personne), soit CONSERVÉE rattachée au compte
 * anonymisé (contenu collectif qui concerne d'autres membres), soit traitée à part (CUSTOM).
 */

import type { Prisma } from "@prisma/client";

export type RelationAction = "DELETE" | "KEEP" | "CUSTOM";

export interface RelationRule {
  action: RelationAction;
  reason: string;
}

const del = (reason: string): RelationRule => ({ action: "DELETE", reason });
const keep = (reason: string): RelationRule => ({ action: "KEEP", reason });
const custom = (reason: string): RelationRule => ({ action: "CUSTOM", reason });

const CATALOGUE = "catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre »";
const AUDIT = "journal d'audit conservé sans lien identifiant (le compte est anonymisé)";
const DECISION = "décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé";

/** Relations vers `User` portées par une clé étrangère (clé `Modèle.champ`, exhaustif : 120 au 21/11/2026). */
export const USER_RELATION_PLAN: Record<string, RelationRule> = {
  // Jeux, bibliothèque, disponibilités
  "Game.addedById": keep("fiche de jeu du catalogue commun (Restrict) : pas une donnée personnelle"),
  "UserGame.userId": del("bibliothèque personnelle"),
  "UserGameRefusal.userId": del("préférences personnelles"),
  "UserGameLevel.userId": del("niveau de jeu auto-déclaré"),
  "Friendship.requesterId": del("demandes d’ami envoyées et amitiés (donnée personnelle : relation entre deux personnes)"),
  "Friendship.addresseeId": del("demandes d’ami reçues et amitiés (donnée personnelle)"),
  "GamePingOptIn.userId": del("abonnements personnels aux jeux suivis"),
  "WeeklyAvailability.userId": del("disponibilités récurrentes"),
  "AvailabilityOverride.userId": del("disponibilités ponctuelles"),
  "TierlistEntry.userId": del("tierlist personnelle"),
  "GameStyleProfile.userId": del("profil de style de jeu"),
  "UserTag.userId": del("tags personnels"),
  "PlatformConnectionSuggestion.userId": del("suggestions d'identifiants issues du scope OAuth connections"),

  // Soirées
  "Session.createdById": keep("soirée avec invités et résultats (Restrict) : conservée, créateur affiché « Ancien membre », gérée par les ADMIN/OWNER"),
  "Session.coOrganizerId": keep(DECISION),
  "SessionInvite.userId": del("invitation reçue par la personne"),
  "SessionInvite.invitedById": keep("invitation envoyée à d'autres membres (Restrict)"),
  "SessionInvite.revokedById": keep(DECISION),
  "SessionApplication.applicantId": del("candidature de la personne"),
  "SessionApplication.decidedById": keep(DECISION),
  "SessionSeat.userId": del("place réservée par la personne"),
  "SessionPreparation.userId": del("checklist de préparation personnelle"),
  "Proposal.proposedById": keep("proposition de jeu d'une soirée (Restrict) : fait partie du vote des autres"),
  "Vote.userId": del("vote de la personne (un vote fantôme ne doit plus compter)"),
  "SessionVeto.userId": del("veto de la personne"),
  "RouletteVeto.userId": del("veto de la personne"),
  "SessionResult.userId": keep("résultat de soirée : classement et statistiques des autres membres en dépendent"),
  "SessionAttendance.userId": keep("présence à une soirée terminée : statistiques collectives"),
  "SessionRating.userId": keep("note de soirée : contribue à une moyenne collective, sans identifiant"),
  "SessionVoicePresenceInterval.userId": del("présence vocale (donnée sensible)"),
  "SessionVoicePresenceConsent.userId": del("consentement vocal de la personne"),
  "SessionGalleryMedia.uploadedById": del("médias de galerie de la personne (fichiers privés supprimés avant)"),
  "Pronostic.voterId": del("pronostics de la personne"),
  "Pronostic.predictedUserId": keep("pronostic d'un autre membre sur la personne"),
  "XpBet.voterId": del("paris de la personne"),
  "XpBet.targetUserId": keep("pari d'un autre membre sur la personne"),
  "Debt.debtorId": keep("dette (gage) envers le groupe : conservée sans identifiant, sa suppression l'effacerait pour les autres"),
  "SessionAvailabilityPoll.createdById": keep("sondage de disponibilités avec réponses d'autres membres"),
  "SessionAvailabilityPollParticipant.userId": del("participation et réponses de la personne au sondage"),

  // Soirées instantanées, roulettes
  "Roulette.createdById": keep("roulette partagée (Restrict)"),
  "RouletteEntry.userId": del("participation de la personne à une roulette"),
  "InstantSession.createdById": keep("partie « Jouer maintenant » partagée (Restrict)"),
  "InstantSessionPresenceInterval.userId": del("présence de la personne dans une partie instantanée"),
  "InstantSessionInterest.userId": del("intérêt exprimé par la personne"),

  // XP, progression, saisons, badges
  "XpEvent.userId": del("historique d'XP de la personne"),
  "LevelUpEvent.userId": del("historique de niveaux de la personne"),
  "UserLifetimeStats.userId": del("statistiques à vie de la personne"),
  "CommunityMemberStats.userId": del("progression de la personne (elle quitte les classements en cours)"),
  "SeasonSnapshot.userId": keep("archive de classement d'une saison close : les rangs des autres en dépendent"),
  "UserBadge.userId": del("badges gagnés par la personne"),
  "Badge.modifiedById": keep(AUDIT),
  "GameStatType.modifiedById": keep(AUDIT),
  "Superlative.modifiedById": keep(AUDIT),
  "SuperlativeCategory.modifiedById": keep(AUDIT),
  "SuperlativeVote.voterUserId": del("votes de superlatifs de la personne"),
  "SuperlativeVote.votedForUserId": keep("vote d'un autre membre pour la personne"),
  "SuperlativeAward.winnerUserId": keep("superlatif attribué à l'issue d'une soirée : résultat collectif"),
  "MessageTemplate.createdById": keep(AUDIT),
  "MessageTemplate.modifiedById": keep(AUDIT),

  // Tournois
  "Tournament.createdById": keep("tournoi avec d'autres participants (Restrict) : organisateur affiché « Ancien membre »"),
  "Tournament.championId": keep("résultat de tournoi : bracket intact"),
  "TournamentParticipant.userId": keep("participation : l'intégrité du bracket l'exige, joueur affiché « Ancien membre »"),
  "TournamentMatch.player1Id": keep("bracket : un emplacement vide serait lu comme un « bye »"),
  "TournamentMatch.player2Id": keep("bracket : un emplacement vide serait lu comme un « bye »"),
  "TournamentMatch.winnerId": keep("résultat de match"),
  "TournamentMatchReport.reportedById": keep(DECISION),

  // Chat, souhaits, annonces
  "ChatMessage.userId": del("messages de chat de la personne"),
  "ChatReaction.userId": del("réactions de la personne"),
  "GameWishlist.proposedById": keep("suggestion de jeu soutenue par d'autres membres (Restrict)"),
  "GameWishlist.purchasedById": keep("achat enregistré pour le groupe"),
  "GameWishlistVote.userId": del("votes de souhaits de la personne"),
  "FreeGameOffer.createdById": keep(CATALOGUE),
  "PlayerClassified.createdById": del("petites annonces de la personne"),
  "Notification.userId": del("notifications reçues par la personne"),
  "WebPushSubscription.userId": del("abonnements Web Push (endpoint et clés)"),
  "CalendarFeedToken.userId": del("jeton d'abonnement iCal"),
  "UserNotificationPreference.userId": del("préférences de notification"),
  "UserNotificationChannelPreference.userId": del("préférences de canaux de notification"),

  // Équipes, projets, rivalités
  "TeamChallenge.proposedById": keep(DECISION),
  "TeamChallenge.respondedById": keep(DECISION),
  "TeamChallenge.reportedById": keep(DECISION),
  "CommunityTeam.createdById": keep("équipe avec d'autres membres : conservée, la relève du capitaine inactif s'applique"),
  "CommunityTeam.captainId": keep("capitaine : la maintenance des capitaines inactifs reprend la main"),
  "CommunityTeamMember.userId": del("appartenance de la personne aux équipes"),
  "TeamApplication.applicantId": del("candidatures de la personne"),
  "TeamApplication.decidedById": keep(DECISION),
  "CommunityTeamRecruiter.userId": del("rôle de recruteur de la personne"),
  "CommunityTeamRecruiter.namedById": keep(DECISION),
  "TeamTournamentGuest.userId": del("invitation de la personne comme joueur invité"),
  "TeamTournamentGuest.invitedById": keep(DECISION),
  "Project.organizerId": keep("projet avec d'autres participants : conservé, organisateur affiché « Ancien membre »"),
  "ProjectEntry.userId": del("participation de la personne aux projets"),
  "ProjectEntry.decidedById": keep(DECISION),

  // Contenus communautaires
  "CommunityQuickPoll.createdById": keep(CATALOGUE),
  "CommunityQuickPollVote.userId": del("votes de la personne aux sondages éclair"),
  "CommunityGameEpitaph.createdById": keep(CATALOGUE),
  "CommunityExpression.createdById": keep(CATALOGUE),
  "CommunityHighlight.createdById": keep(CATALOGUE),
  "CommunityDate.createdById": keep(CATALOGUE),
  "CommunityDate.memberId": del("date (anniversaire) de la personne"),
  "Membership.userId": del("appartenances de la personne : le compte anonymisé n'appartient plus à aucune communauté"),
  "BoosterSupport.userId": del("soutien Nitro de la personne (porte son identifiant Discord)"),

  // The Tower
  "TowerChallengeAttempt.userId": custom("défis solo : supprimés avec preuves, votes et recours ; défis d'équipe partagés : conservés, preuve effacée"),
  "TowerChallengeAttemptParticipant.userId": del("participation de la personne à des défis"),
  "TowerChallengeVote.userId": del("votes de preuves de la personne"),
  "TowerChallengeProgress.userId": del("progression Tower de la personne"),
  "TowerChallengeReplacement.userId": del("remplacements de défis de la personne"),
  "TowerChallengeAppeal.arbiterUserId": keep("recours arbitré par la personne (NoAction) : décision conservée"),
  "TowerChallengeProposal.proposerId": keep("proposition de défi au catalogue : contenu partagé, sans lien identifiant"),
  "TowerChallengeProposal.decidedById": keep(DECISION),
  "TowerSeasonAward.userId": del("titre et cadre cosmétiques de la personne"),
  "TowerSeasonVoteBallot.voterUserId": del("bulletin de la personne"),
  "TowerSeasonVoteBallot.candidateUserId": keep("bulletin d'un autre membre pour la personne"),
  "TowerIrregularGrant.userId": del("grade Irregular de la personne"),
  "TowerIrregularGrant.grantedById": keep(AUDIT),
  "TowerIrregularGrant.revokedById": keep(AUDIT),
  "TowerIrregularLog.userId": keep(AUDIT),
  "TowerIrregularLog.actorId": keep(AUDIT),

  // Profil
  "UserProfileVisibility.userId": del("réglage de visibilité du profil"),
  "UserProfileEffectsPreference.userId": del("préférence d'effets de profil"),
  "ProfileEntitlement.userId": del("droits cosmétiques du profil"),
  "ProfileCustomization.userId": del("personnalisation du profil"),
};

export type NonFkAction = "DELETE" | "KEEP" | "SCRUB" | "COVERED";

export interface NonFkRule {
  action: NonFkAction;
  reason: string;
}

/**
 * `COVERED` = la ligne est déjà supprimée par une règle de clé étrangère. Champs qui désignent une personne SANS clé étrangère vers `User` (identifiants Discord, copies de noms, JSON
 * libres). `SCRUB` = la ligne reste, l'identifiant ou le texte est neutralisé par `account-deletion.ts`.
 */
export const NON_FK_PLAN: Record<string, NonFkRule> = {
  "CreationIntent.actorId": { action: "DELETE", reason: "reçu d'idempotence de la personne" },
  "PlayerClassifiedPing.userId": { action: "DELETE", reason: "compteur de pings forum de la personne" },
  "CommunityMemberCosmetic.userId": { action: "DELETE", reason: "cosmétiques achetés en XP par la personne" },
  "SessionAvailabilityPollResponse.userId": { action: "DELETE", reason: "réponses de la personne aux sondages" },
  "TournamentPrediction.voterId": { action: "DELETE", reason: "pronostics de tournoi de la personne" },
  "TournamentPrediction.predictedUserId": { action: "KEEP", reason: "pronostic d'un autre membre" },
  "TournamentTeamMember.userId": { action: "KEEP", reason: "équipe de tournoi : rattachée au participant conservé" },
  "TowerChallengeAppeal.authorUserId": { action: "DELETE", reason: "recours déposés par la personne (texte libre)" },
  "TowerChallengeAppeal.reviewerUserId": { action: "KEEP", reason: "examen par le staff : identifiant opaque" },
  "TowerChallengeAttempt.doubtReportedByUserId": { action: "SCRUB", reason: "mis à NULL : signalement de doute de la personne" },
  "TowerSeasonVote.candidateUserIds": { action: "KEEP", reason: "liste d'identifiants opaques de candidats" },
  "TowerArbiterConfigurationChange.previousArbiterUserId": { action: "KEEP", reason: AUDIT },
  "TowerArbiterConfigurationChange.arbiterUserId": { action: "KEEP", reason: AUDIT },
  "TowerArbiterConfigurationChange.changedByUserId": { action: "KEEP", reason: AUDIT },
  "Session.notifiedUserIds": { action: "KEEP", reason: "liste d'identifiants opaques déjà notifiés" },
  "Roulette.notifiedUserIds": { action: "KEEP", reason: "liste d'identifiants opaques déjà notifiés" },
  "InstantSession.notifiedUserIds": { action: "KEEP", reason: "liste d'identifiants opaques déjà notifiés" },
  "Tournament.notifiedUserIds": { action: "KEEP", reason: "liste d'identifiants opaques déjà notifiés" },
  "XpAdjustment.userId": { action: "KEEP", reason: AUDIT },
  "XpAdjustment.userName": { action: "SCRUB", reason: "copie du pseudo remplacée par « Ancien membre »" },
  "XpAdjustment.adminId": { action: "KEEP", reason: AUDIT },
  "XpAdjustment.adminName": { action: "SCRUB", reason: "copie du pseudo de l'administrateur remplacée par « Ancien membre »" },
  "NotificationEvent.payload": { action: "SCRUB", reason: "JSON libre : pseudo, identifiant Discord et mentions neutralisés" },
  "MonthlyRecap.data": { action: "SCRUB", reason: "récap mensuel figé : pseudos neutralisés" },
  "ModerationReport.authorDiscordId": { action: "SCRUB", reason: "identifiant Discord remplacé ; l'extrait du message de la personne est effacé" },
  "ModerationReport.reporterDiscordId": { action: "SCRUB", reason: "identifiant Discord remplacé par un jeton neutre" },
  "DiscordRoleRequest.requesterDiscordId": { action: "SCRUB", reason: "identifiant Discord remplacé par un jeton neutre" },
  "Community.installedByDiscordId": { action: "SCRUB", reason: "mis à NULL : identifiant Discord de la personne qui a installé le bot" },
  "Community.activatedById": { action: "KEEP", reason: "identifiant opaque du compte qui a activé la communauté" },
  "BoosterSupport.discordId": { action: "COVERED", reason: "ligne supprimée avec le soutien (BoosterSupport.userId)" },
  "SensitiveOperationLog.actorId": { action: "KEEP", reason: "journal des opérations sensibles : identifiant opaque de l'administrateur, sans texte saisi" },
  "AccountDeletionLog.userId": { action: "KEEP", reason: "journal de suppression sans donnée personnelle (identifiant opaque + compteurs)" },
};

/** Textes libres où le pseudo ou l'identifiant d'une personne peut figurer dans les lignes d'AUTRES membres. */
export const TEXT_SCRUB_COLUMNS: ReadonlyArray<{ model: string; table: string; columns: readonly string[] }> = [
  { model: "Notification", table: "Notification", columns: ["title", "message"] },
  { model: "Debt", table: "Debt", columns: ["reason", "gage"] },
  { model: "NotificationDelivery", table: "NotificationDelivery", columns: ["lastError"] },
  { model: "ModerationReport", table: "ModerationReport", columns: ["excerpt"] },
];

/** Colonnes JSON libres où les chaînes sont réécrites (jamais les clés). */
export const JSON_SCRUB_COLUMNS: ReadonlyArray<{ model: string; table: string; column: string }> = [
  { model: "NotificationEvent", table: "NotificationEvent", column: "payload" },
  { model: "MonthlyRecap", table: "MonthlyRecap", column: "data" },
];

export const ANONYMOUS_NAME = "Ancien membre";
export const TOMBSTONE_DISCORD_ID_PREFIX = "deleted:";

export function tombstoneDiscordId(userId: string): string {
  return `${TOMBSTONE_DISCORD_ID_PREFIX}${userId}`;
}

export function isTombstoneDiscordId(discordId: string): boolean {
  return discordId.startsWith(TOMBSTONE_DISCORD_ID_PREFIX);
}

/** Colonnes scalaires de `User` conservées telles quelles (aucune donnée personnelle), avec la raison. */
export const USER_COLUMNS_KEPT: Record<string, string> = {
  id: "identifiant opaque : les clés étrangères des contenus conservés pointent dessus",
  createdAt: "date de création du compte, sans donnée personnelle",
  onboardingCompleted: "booléen sans identifiant",
  soundEnabled: "booléen sans identifiant",
  colorCustomized: "remis à false avec la couleur par défaut",
};

/**
 * Valeurs écrites sur la ligne `User` pour l'anonymiser. Chaque colonne scalaire de `User` est ici ou dans
 * `USER_COLUMNS_KEPT` (test). `forceReloginAt` invalide les sessions en cours ; l'identifiant Discord remplacé
 * par `deleted:<id>` le fait déjà (la session est retrouvée par `discordId`) et libère l'identifiant d'origine :
 * la personne qui se reconnecte obtient un NOUVEAU compte.
 */
export function tombstoneUserData(userId: string, now: Date): Prisma.UserUpdateInput {
  return {
    discordId: tombstoneDiscordId(userId),
    discordName: ANONYMOUS_NAME,
    discordAvatar: null,
    discordAccessToken: null,
    discordRefreshToken: null,
    discordTokenExpiresAt: null,
    forceReloginAt: now,
    bannerUrl: null,
    steamId64: null,
    psnId: null,
    xboxGamertag: null,
    switchFriendCode: null,
    epicDisplayName: null,
    battleTag: null,
    riotId: null,
    steamPublic: false,
    preferredGameCategories: [],
    refusedGameCategories: [],
    inputDevices: [],
    availablePlatforms: [],
    microphoneAvailable: null,
    languages: [],
    playHabits: [],
    communityPreferences: [],
    steamLastSyncAt: null,
    steamActivityCheckedAt: null,
    steamFullSyncAttemptedAt: null,
    silenceReminders: false,
    role: "USER",
    color: "#8b5cf6",
    colorCustomized: false,
    xpTotal: 0,
    streakCount: 0,
    streakLastActiveAt: null,
    bestStreakCount: 0,
    lastPlayedGame: null,
    lastPlayedAt: null,
    steamNowPlaying: null,
    steamNowPlayingSeenAt: null,
    activeCommunityId: null,
  };
}

export function modelAccessor(model: string): string {
  return model[0].toLowerCase() + model.slice(1);
}

/** Entrées du plan par action, dans l'ordre de déclaration. */
export function planEntries(action: RelationAction): Array<{ model: string; field: string; rule: RelationRule }> {
  return Object.entries(USER_RELATION_PLAN)
    .filter(([, rule]) => rule.action === action)
    .map(([key, rule]) => {
      const [model, field] = key.split(".");
      return { model, field, rule };
    });
}

export function nonFkEntries(action: NonFkAction): Array<{ model: string; field: string; rule: NonFkRule }> {
  return Object.entries(NON_FK_PLAN)
    .filter(([, rule]) => rule.action === action)
    .map(([key, rule]) => {
      const [model, field] = key.split(".");
      return { model, field, rule };
    });
}

/**
 * Remplace, dans une valeur JSON, chaque CHAÎNE contenant l'un des aiguilles (jamais les clés). Retourne la
 * nouvelle valeur et si elle a changé. Pur.
 */
export function scrubJsonValue(value: unknown, needles: readonly string[], replacement: string): { value: unknown; changed: boolean } {
  const usable = needles.filter((needle) => needle.length > 0);
  if (typeof value === "string") {
    let next = value;
    for (const needle of usable) next = next.split(needle).join(replacement);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = scrubJsonValue(item, usable, replacement);
      changed ||= result.changed;
      return result.value;
    });
    return { value: items, changed };
  }
  if (value !== null && typeof value === "object") {
    let changed = false;
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const result = scrubJsonValue(item, usable, replacement);
      changed ||= result.changed;
      return [key, result.value] as const;
    });
    return { value: Object.fromEntries(entries), changed };
  }
  return { value, changed: false };
}

/** Aiguilles de pseudo : un pseudo de moins de 3 caractères n'est pas cherché dans les textes (trop de faux positifs). */
export function scrubNeedles(user: { discordId: string; discordName: string }): string[] {
  const needles = [user.discordId];
  if (user.discordName.trim().length >= 3) needles.push(user.discordName);
  return needles;
}
