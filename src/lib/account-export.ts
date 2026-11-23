import { prisma } from "@/lib/prisma";
import { NON_FK_PLAN, USER_RELATION_PLAN, modelAccessor } from "@/lib/account-deletion-plan";

/**
 * Export des données personnelles (ACCOUNT_DELETION_ENABLED, droits d'accès et de portabilité, RGPD art. 15 et 20).
 * Module de la liste SCOPED_MODULES de `community-scope.test.ts` : chaque lecture est filtrée par l'identifiant de
 * LA personne qui exporte (jamais par communauté, ses données traversent les communautés).
 *
 * Garanties : uniquement les lignes que la personne a créées ou qui la concernent ; jamais les jetons OAuth, les
 * clés d'abonnement Web Push ni les empreintes de jetons iCal ; aucun identifiant d'un autre membre (toute colonne
 * qui référence un utilisateur et ne vaut pas l'identifiant de la personne est retirée de la ligne) ; jamais de
 * valeur chiffrée. Les fichiers (bannière, médias de galerie) ne sont pas inclus : seules leurs métadonnées le sont.
 */

/** Une section = une relation du classement, exportée pour la personne. `select` restreint les colonnes sensibles. */
interface ExportSection {
  /** `Modèle.champ` de `USER_RELATION_PLAN` : la personne est le sujet ou l'auteur de ces lignes. */
  source: string;
  select?: Record<string, true>;
}

const SECTION_SOURCES: readonly (string | ExportSection)[] = [
  // Profil, préférences, appartenances
  "Membership.userId",
  "UserProfileVisibility.userId",
  "UserProfileEffectsPreference.userId",
  "ProfileCustomization.userId",
  "ProfileEntitlement.userId",
  "UserNotificationPreference.userId",
  "UserNotificationChannelPreference.userId",
  "UserGameLevel.userId",
  "UserGameRefusal.userId",
  "GameStyleProfile.userId",
  "UserTag.userId",
  "PlatformConnectionSuggestion.userId",
  "GamePingOptIn.userId",
  "BoosterSupport.userId",
  // Bibliothèque, disponibilités, tierlist
  "UserGame.userId",
  "WeeklyAvailability.userId",
  "AvailabilityOverride.userId",
  "TierlistEntry.userId",
  "Game.addedById",
  "GameWishlist.proposedById",
  "GameWishlistVote.userId",
  // Progression
  "CommunityMemberStats.userId",
  "UserLifetimeStats.userId",
  "XpEvent.userId",
  "LevelUpEvent.userId",
  "UserBadge.userId",
  "SeasonSnapshot.userId",
  "SuperlativeAward.winnerUserId",
  // Soirées
  "Session.createdById",
  "Proposal.proposedById",
  "Vote.userId",
  "SessionVeto.userId",
  "RouletteVeto.userId",
  "SessionInvite.userId",
  "SessionApplication.applicantId",
  "SessionSeat.userId",
  "SessionPreparation.userId",
  "SessionResult.userId",
  "SessionAttendance.userId",
  "SessionRating.userId",
  "SessionVoicePresenceInterval.userId",
  "SessionVoicePresenceConsent.userId",
  "SessionAvailabilityPoll.createdById",
  "SessionAvailabilityPollParticipant.userId",
  "Pronostic.voterId",
  "XpBet.voterId",
  "Debt.debtorId",
  "SuperlativeVote.voterUserId",
  "Roulette.createdById",
  "RouletteEntry.userId",
  "InstantSession.createdById",
  "InstantSessionPresenceInterval.userId",
  "InstantSessionInterest.userId",
  // Tournois, équipes, projets
  "Tournament.createdById",
  "TournamentParticipant.userId",
  "CommunityTeam.createdById",
  "CommunityTeamMember.userId",
  "TeamApplication.applicantId",
  "CommunityTeamRecruiter.userId",
  "TeamTournamentGuest.userId",
  "Project.organizerId",
  "ProjectEntry.userId",
  // Messages, annonces, contenus
  "ChatMessage.userId",
  "ChatReaction.userId",
  "PlayerClassified.createdById",
  "CommunityQuickPoll.createdById",
  "CommunityQuickPollVote.userId",
  "CommunityGameEpitaph.createdById",
  "CommunityExpression.createdById",
  "CommunityHighlight.createdById",
  "CommunityDate.createdById",
  "CommunityDate.memberId",
  // Médias (métadonnées seulement : le chemin de stockage n'est pas exporté)
  { source: "SessionGalleryMedia.uploadedById", select: { id: true, sessionId: true, mimeType: true, sizeBytes: true, createdAt: true } },
  // Notifications et appareils (aucun secret)
  "Notification.userId",
  { source: "WebPushSubscription.userId", select: { id: true, createdAt: true, updatedAt: true } },
  { source: "CalendarFeedToken.userId", select: { id: true, communityId: true, createdAt: true, revokedAt: true } },
  // The Tower
  "TowerChallengeAttempt.userId",
  "TowerChallengeAttemptParticipant.userId",
  "TowerChallengeVote.userId",
  "TowerChallengeProgress.userId",
  "TowerChallengeReplacement.userId",
  "TowerChallengeProposal.proposerId",
  "TowerSeasonAward.userId",
  "TowerSeasonVoteBallot.voterUserId",
  "TowerIrregularGrant.userId",
];

/** Colonnes jamais exportées, quelle que soit la ligne. */
const NEVER_EXPORTED = new Set(["notifiedUserIds", "remindersSent", "tokenHash", "endpoint", "p256dh", "auth", "pathname", "discordAccessToken", "discordRefreshToken"]);

/** Colonnes qui référencent un utilisateur : retirées quand elles ne désignent pas la personne. */
const USER_REFERENCE_COLUMNS = new Set([
  ...Object.keys(USER_RELATION_PLAN).map((key) => key.split(".")[1]),
  ...Object.keys(NON_FK_PLAN).map((key) => key.split(".")[1]).filter((field) => /user|voter|actor|author|reporter|reviewer|arbiter/i.test(field)),
]);

/** Ligne propre à la personne : sans colonne secrète ni identifiant d'un autre membre. Pure. */
export function ownRow(row: Record<string, unknown>, userId: string): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (NEVER_EXPORTED.has(key)) continue;
    if (USER_REFERENCE_COLUMNS.has(key) && typeof value === "string" && value !== userId) continue;
    clean[key] = value;
  }
  return clean;
}

type FindManyDelegate = { findMany(args: { where: Record<string, unknown>; select?: Record<string, true> }): Promise<Record<string, unknown>[]> };

export interface AccountExport {
  format: "gamenight-export-v1";
  generatedAt: string;
  notice: string[];
  compte: Record<string, unknown>;
  donnees: Record<string, Record<string, unknown>[]>;
}

export const EXPORT_NOTICE = [
  "Ce fichier ne contient que tes propres données et les contenus que tu as créés.",
  "Il ne contient jamais tes jetons de connexion Discord, les clés de tes appareils de notification ni le contenu de tes fichiers (bannière, médias de galerie : seules leurs métadonnées figurent ici).",
  "Les identifiants des autres membres en sont retirés ; les textes de tes notifications peuvent citer leur pseudo.",
];

/** Noms des sections exportées (pour la documentation et les tests). */
export function exportSectionModels(): string[] {
  return SECTION_SOURCES.map((section) => (typeof section === "string" ? section : section.source).split(".")[0]);
}

export async function buildAccountExport(userId: string, now: Date = new Date()): Promise<AccountExport | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, discordId: true, discordName: true, discordAvatar: true, bannerUrl: true, color: true, role: true, createdAt: true,
      steamId64: true, steamPublic: true, steamLastSyncAt: true, psnId: true, xboxGamertag: true, switchFriendCode: true, epicDisplayName: true,
      battleTag: true, riotId: true, preferredGameCategories: true, refusedGameCategories: true, inputDevices: true, availablePlatforms: true,
      microphoneAvailable: true, languages: true, playHabits: true, communityPreferences: true, silenceReminders: true, soundEnabled: true, onboardingCompleted: true, xpTotal: true, streakCount: true,
      bestStreakCount: true, lastPlayedGame: true, lastPlayedAt: true,
    },
  });
  if (!user) return null;

  const donnees: Record<string, Record<string, unknown>[]> = {};
  for (const section of SECTION_SOURCES) {
    const { source, select } = typeof section === "string" ? { source: section, select: undefined } : section;
    const [model, field] = source.split(".");
    const delegate = (prisma as unknown as Record<string, FindManyDelegate | undefined>)[modelAccessor(model)];
    if (!delegate || typeof delegate.findMany !== "function") throw new Error(`Modèle Prisma introuvable pour l'export : ${model}`);
    const rows = await delegate.findMany({ where: { [field]: userId }, ...(select ? { select } : {}) });
    if (rows.length === 0) continue;
    const merged = (donnees[model] ?? []).concat(rows.map((row) => ownRow(row, userId)));
    // Un même modèle peut figurer par deux champs (ex. CommunityDate : créée par la personne et la concernant).
    const seen = new Set<unknown>();
    donnees[model] = merged.filter((row) => {
      if (row.id === undefined) return true;
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  return {
    format: "gamenight-export-v1",
    generatedAt: now.toISOString(),
    notice: EXPORT_NOTICE,
    compte: ownRow(user, userId),
    donnees,
  };
}

/** Sérialisation lisible : indentée, les BigInt en texte. */
export function serializeAccountExport(data: AccountExport): string {
  return JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2);
}
