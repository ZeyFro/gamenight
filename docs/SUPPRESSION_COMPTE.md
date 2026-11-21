# Suppression et export de compte

Interrupteur `ACCOUNT_DELETION_ENABLED` (OFF par défaut, actif seulement si la valeur vaut exactement `true`). Répond au constat **V1-02** (droit à l'effacement, BLOQUANT) de [AUDIT_APP_20261120.md](AUDIT_APP_20261120.md), et aux constats V1-04 (export), V1-05 (données hors base), V1-08 (jetons OAuth), V1-09 (inventaire des données) et V1-13 (médias de galerie).

Page : `/profil/compte` (lien depuis `/profil/parametres`, section absente flag éteint). Export : `GET /api/compte/export`. Flag éteint : la page, l'export et l'action de suppression répondent **404 côté serveur** (pas seulement une interface cachée).

## Principe : anonymiser, jamais supprimer la ligne `User`

Une suppression SQL de `User` échoue : 14 relations sont en `Restrict` (créateur d'une soirée, d'un jeu, d'un tournoi, d'une proposition, d'une roulette, etc.) et 1 en `NoAction`. La forcer détruirait en cascade des données collectives (dettes, pronostics, résultats). La suppression de compte fait donc, dans **une seule transaction** :

1. **Supprime** les données purement personnelles (tableau ci-dessous).
2. **Conserve** les contenus qui concernent d'autres membres, rattachés à un compte anonymisé affiché « Ancien membre ».
3. **Neutralise** les identifiants Discord et les pseudos cités dans des textes ou JSON libres, y compris dans des lignes d'autres membres (notifications reçues, récaps, journaux).
4. **Anonymise la ligne `User`** : identifiant Discord remplacé par `deleted:<id>`, pseudo « Ancien membre », avatar, bannière, jetons OAuth, Steam, identifiants de plateformes, préférences et compteurs effacés, `forceReloginAt` posé. Aucune `Membership` ne subsiste : le compte n'appartient à aucune communauté et n'apparaît dans aucune liste de membres.
5. Écrit une ligne dans `AccountDeletionLog` (identifiant opaque et compteurs par table, **aucune donnée personnelle**).

Avant la transaction, les **fichiers Blob** sont supprimés : bannière publique (`banners/<id>/…`, y compris les anciennes versions et l'ancien format `banners/<id>-…`) et médias de galerie privés. Un échec de suppression de fichier **refuse** la suppression sans rien changer en base (la personne peut réessayer) ; jamais de silence. Les médias de galerie exigent `SESSION_MEDIA_BLOB_TOKEN` quand la personne en a ; sans lui la suppression est refusée avec le message « réessaie plus tard ».

### Session et reconnexion

- La session Auth.js (JWT) retrouve l'utilisateur par `discordId`. Ce dernier ayant changé, l'ancienne session ne désigne plus personne (`getCurrentUser` renvoie `null`) ; `forceReloginAt` est posé en plus. L'action ferme ensuite la session (`signOut`) et renvoie à l'accueil.
- L'identifiant Discord d'origine et le `steamId64` sont **libérés** (contraintes d'unicité) : la personne qui se reconnecte plus tard obtient un **nouveau compte vide**, sans lien avec l'ancien (test d'intégration). Les anciennes sessions d'un autre appareil, encore valides côté navigateur, désigneraient alors ce nouveau compte : c'est la même personne, et elle n'hérite d'aucune donnée de l'ancien.
- Les `ADMIN_DISCORD_IDS` (variable d'environnement) ne sont pas liés au compte en base : un administrateur supprimé peut se reconnecter, avec un compte neuf et le rôle donné par la variable. Le rôle `ADMIN` de la ligne anonymisée est remis à `USER`.

### Refus : dernier propriétaire

Si la personne est le **seul OWNER ACTIF** d'une communauté (au moins une), la suppression est **refusée** (rien n'est modifié, aucun fichier supprimé) avec le message « Tu es le dernier propriétaire d'une communauté. Désigne un autre propriétaire avant de supprimer ton compte ». Un OWNER dont l'appartenance est `LEFT` ou `REMOVED` ne compte pas comme successeur. Le contrôle est refait dans la transaction, avec un verrou sur les communautés concernées, pour que deux propriétaires qui se suppriment en même temps ne laissent pas une communauté sans propriétaire. Le transfert de propriété n'est pas automatisé (hors périmètre) : il se fait en base ou par l'administration.

### Capitaines, organisateurs, créateurs

Les équipes, soirées, tournois, projets et roulettes que la personne a créés **restent** pour les autres membres, avec « Ancien membre » comme auteur. Conséquences à connaître :

- une **soirée à venir** créée par la personne n'a plus de créateur actif : seuls les ADMIN/OWNER de la communauté peuvent la gérer ou l'annuler ; sa participation (vote, place, invitation reçue) est supprimée ;
- une équipe dont elle était capitaine garde un capitaine anonymisé : la relève des capitaines inactifs (`TEAM_CAPTAIN_HANDOVER_ENABLED`) reprend la main, ou un ADMIN intervient ;
- les MP que l'application voudrait encore envoyer à ce créateur (rappels, résultats) ne sont **jamais ouverts** : `openDmChannel` (`src/lib/discord-rest.ts`) refuse un identifiant `deleted:…` sans appel réseau (échec définitif `invalid_request`, la livraison passe en échec sans nouvelle tentative) ; une éventuelle mention `<@deleted:…>` s'afficherait en texte brut sans notifier personne (affichage non vérifié sur Discord : à contrôler lors de la vérification d'activation) ;
- un tournoi en cours reste jouable : l'emplacement du joueur dans le bracket est conservé (un emplacement vide serait lu comme un « bye »).

## Ce que la suppression ne couvre PAS

- **Discord** : aucun appel Discord n'est fait (aucune notification, aucune suppression). Les annonces, fils, messages de preuves Tower, MP du bot et rôles déjà créés restent sur Discord ; leur retrait est manuel, par l'équipe d'administration du serveur, à la demande de la personne. Les identifiants de message conservés dans les défis Tower partagés (`proofChannelId`, `proofMessageId`) servent à retrouver ces messages ; le texte de la preuve est remplacé par « [supprimé] ».
- **Sauvegardes Neon** : la restauration instantanée conserve l'état antérieur pendant la durée de rétention du plan Neon (à vérifier dans la console, [MIGRATIONS.md](MIGRATIONS.md)). Une restauration à une date antérieure à la suppression ramènerait la personne : la rejouer ensuite.
- **Contenus libres écrits par d'autres membres** qui citeraient son pseudo dans un champ non listé ci-dessous (chronique d'une soirée, exploit, expression) : non détectés, à retirer à la main.
- **Pseudos de moins de 3 caractères** : non recherchés dans les textes d'autres lignes (trop de faux positifs) ; l'identifiant Discord l'est toujours.
- Le compte Discord lui-même n'est jamais touché.
- Aucun **e-mail** n'est stocké par GameNight (le scope OAuth `email` n'est pas persisté) : rien à effacer de ce côté.

## Export des données personnelles

`GET /api/compte/export` (connecté, 3 requêtes par minute) renvoie un fichier `gamenight-mes-donnees-AAAA-MM-JJ.json` lisible (indenté) :

- uniquement les lignes que la personne a créées ou qui la concernent, **toutes communautés** ;
- **jamais** les jetons OAuth Discord, les clés des abonnements Web Push (seules la date de création et l'identifiant figurent), les empreintes de jetons iCal, ni les chemins de stockage des médias (métadonnées seulement) ;
- toute colonne qui référence un utilisateur et ne vaut pas l'identifiant de la personne est **retirée** de la ligne (aucun identifiant d'autrui) ; les listes d'identifiants notifiés sont retirées ;
- aucune valeur chiffrée ; les fichiers eux-mêmes (bannière, galerie) ne sont pas inclus ;
- limite connue : le texte de tes notifications peut citer le pseudo d'un autre membre (« X n'a jamais gagné à… »).

Les sections exportées sont la liste `SECTION_SOURCES` de `src/lib/account-export.ts` (profil, appartenances, préférences, bibliothèque, disponibilités, progression, soirées créées et participations, tournois, équipes, messages, annonces, notifications, défis Tower, médias).

## Relations vers `User` : classement complet

Source de vérité : `src/lib/account-deletion-plan.ts`. Le test `src/lib/account-deletion-plan.test.ts` lit `prisma/schema.prisma` et **échoue si une relation vers `User`, un champ-identifiant sans clé étrangère ou une colonne de `User` n'est pas classé** : l'auteur d'une nouvelle relation choisit alors supprimer / conserver, avec sa raison. Il échoue aussi si un modèle supprimé est référencé en `Restrict`/`NoAction` (la suppression échouerait sur une clé étrangère). 120 relations : 61 supprimées, 58 conservées, 1 traitée à part.

### Relations avec clé étrangère

| Relation | Traitement | Raison |
| --- | --- | --- |
| `Game.addedById` | Conservé | fiche de jeu du catalogue commun (Restrict) : pas une donnée personnelle |
| `UserGame.userId` | Supprimé | bibliothèque personnelle |
| `UserGameRefusal.userId` | Supprimé | préférences personnelles |
| `UserGameLevel.userId` | Supprimé | niveau de jeu auto-déclaré |
| `GamePingOptIn.userId` | Supprimé | abonnements personnels aux jeux suivis |
| `WeeklyAvailability.userId` | Supprimé | disponibilités récurrentes |
| `AvailabilityOverride.userId` | Supprimé | disponibilités ponctuelles |
| `TierlistEntry.userId` | Supprimé | tierlist personnelle |
| `GameStyleProfile.userId` | Supprimé | profil de style de jeu |
| `UserTag.userId` | Supprimé | tags personnels |
| `PlatformConnectionSuggestion.userId` | Supprimé | suggestions d'identifiants issues du scope OAuth connections |
| `Session.createdById` | Conservé | soirée avec invités et résultats (Restrict) : conservée, créateur affiché « Ancien membre », gérée par les ADMIN/OWNER |
| `Session.coOrganizerId` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `SessionInvite.userId` | Supprimé | invitation reçue par la personne |
| `SessionInvite.invitedById` | Conservé | invitation envoyée à d'autres membres (Restrict) |
| `SessionInvite.revokedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `SessionApplication.applicantId` | Supprimé | candidature de la personne |
| `SessionApplication.decidedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `SessionSeat.userId` | Supprimé | place réservée par la personne |
| `SessionPreparation.userId` | Supprimé | checklist de préparation personnelle |
| `Proposal.proposedById` | Conservé | proposition de jeu d'une soirée (Restrict) : fait partie du vote des autres |
| `Vote.userId` | Supprimé | vote de la personne (un vote fantôme ne doit plus compter) |
| `SessionVeto.userId` | Supprimé | veto de la personne |
| `RouletteVeto.userId` | Supprimé | veto de la personne |
| `SessionResult.userId` | Conservé | résultat de soirée : classement et statistiques des autres membres en dépendent |
| `SessionAttendance.userId` | Conservé | présence à une soirée terminée : statistiques collectives |
| `SessionRating.userId` | Conservé | note de soirée : contribue à une moyenne collective, sans identifiant |
| `SessionVoicePresenceInterval.userId` | Supprimé | présence vocale (donnée sensible) |
| `SessionVoicePresenceConsent.userId` | Supprimé | consentement vocal de la personne |
| `SessionGalleryMedia.uploadedById` | Supprimé | médias de galerie de la personne (fichiers privés supprimés avant) |
| `Pronostic.voterId` | Supprimé | pronostics de la personne |
| `Pronostic.predictedUserId` | Conservé | pronostic d'un autre membre sur la personne |
| `XpBet.voterId` | Supprimé | paris de la personne |
| `XpBet.targetUserId` | Conservé | pari d'un autre membre sur la personne |
| `Debt.debtorId` | Conservé | dette (gage) envers le groupe : conservée sans identifiant, sa suppression l'effacerait pour les autres |
| `SessionAvailabilityPoll.createdById` | Conservé | sondage de disponibilités avec réponses d'autres membres |
| `SessionAvailabilityPollParticipant.userId` | Supprimé | participation et réponses de la personne au sondage |
| `Roulette.createdById` | Conservé | roulette partagée (Restrict) |
| `RouletteEntry.userId` | Supprimé | participation de la personne à une roulette |
| `InstantSession.createdById` | Conservé | partie « Jouer maintenant » partagée (Restrict) |
| `InstantSessionPresenceInterval.userId` | Supprimé | présence de la personne dans une partie instantanée |
| `InstantSessionInterest.userId` | Supprimé | intérêt exprimé par la personne |
| `XpEvent.userId` | Supprimé | historique d'XP de la personne |
| `LevelUpEvent.userId` | Supprimé | historique de niveaux de la personne |
| `UserLifetimeStats.userId` | Supprimé | statistiques à vie de la personne |
| `CommunityMemberStats.userId` | Supprimé | progression de la personne (elle quitte les classements en cours) |
| `SeasonSnapshot.userId` | Conservé | archive de classement d'une saison close : les rangs des autres en dépendent |
| `UserBadge.userId` | Supprimé | badges gagnés par la personne |
| `Badge.modifiedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `GameStatType.modifiedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `Superlative.modifiedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `SuperlativeCategory.modifiedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `SuperlativeVote.voterUserId` | Supprimé | votes de superlatifs de la personne |
| `SuperlativeVote.votedForUserId` | Conservé | vote d'un autre membre pour la personne |
| `SuperlativeAward.winnerUserId` | Conservé | superlatif attribué à l'issue d'une soirée : résultat collectif |
| `MessageTemplate.createdById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `MessageTemplate.modifiedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `Tournament.createdById` | Conservé | tournoi avec d'autres participants (Restrict) : organisateur affiché « Ancien membre » |
| `Tournament.championId` | Conservé | résultat de tournoi : bracket intact |
| `TournamentParticipant.userId` | Conservé | participation : l'intégrité du bracket l'exige, joueur affiché « Ancien membre » |
| `TournamentMatch.player1Id` | Conservé | bracket : un emplacement vide serait lu comme un « bye » |
| `TournamentMatch.player2Id` | Conservé | bracket : un emplacement vide serait lu comme un « bye » |
| `TournamentMatch.winnerId` | Conservé | résultat de match |
| `TournamentMatchReport.reportedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `ChatMessage.userId` | Supprimé | messages de chat de la personne |
| `ChatReaction.userId` | Supprimé | réactions de la personne |
| `GameWishlist.proposedById` | Conservé | suggestion de jeu soutenue par d'autres membres (Restrict) |
| `GameWishlist.purchasedById` | Conservé | achat enregistré pour le groupe |
| `GameWishlistVote.userId` | Supprimé | votes de souhaits de la personne |
| `FreeGameOffer.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `PlayerClassified.createdById` | Supprimé | petites annonces de la personne |
| `Notification.userId` | Supprimé | notifications reçues par la personne |
| `WebPushSubscription.userId` | Supprimé | abonnements Web Push (endpoint et clés) |
| `CalendarFeedToken.userId` | Supprimé | jeton d'abonnement iCal |
| `UserNotificationPreference.userId` | Supprimé | préférences de notification |
| `UserNotificationChannelPreference.userId` | Supprimé | préférences de canaux de notification |
| `TeamChallenge.proposedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `TeamChallenge.respondedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `TeamChallenge.reportedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `CommunityTeam.createdById` | Conservé | équipe avec d'autres membres : conservée, la relève du capitaine inactif s'applique |
| `CommunityTeam.captainId` | Conservé | capitaine : la maintenance des capitaines inactifs reprend la main |
| `CommunityTeamMember.userId` | Supprimé | appartenance de la personne aux équipes |
| `TeamApplication.applicantId` | Supprimé | candidatures de la personne |
| `TeamApplication.decidedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `CommunityTeamRecruiter.userId` | Supprimé | rôle de recruteur de la personne |
| `CommunityTeamRecruiter.namedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `TeamTournamentGuest.userId` | Supprimé | invitation de la personne comme joueur invité |
| `TeamTournamentGuest.invitedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `Project.organizerId` | Conservé | projet avec d'autres participants : conservé, organisateur affiché « Ancien membre » |
| `ProjectEntry.userId` | Supprimé | participation de la personne aux projets |
| `ProjectEntry.decidedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `CommunityQuickPoll.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `CommunityQuickPollVote.userId` | Supprimé | votes de la personne aux sondages éclair |
| `CommunityGameEpitaph.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `CommunityExpression.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `CommunityHighlight.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `CommunityDate.createdById` | Conservé | catalogue ou contenu partagé de la communauté : sans lien identifiant, auteur affiché « Ancien membre » |
| `CommunityDate.memberId` | Supprimé | date (anniversaire) de la personne |
| `Membership.userId` | Supprimé | appartenances de la personne : le compte anonymisé n'appartient plus à aucune communauté |
| `BoosterSupport.userId` | Supprimé | soutien Nitro de la personne (porte son identifiant Discord) |
| `TowerChallengeAttempt.userId` | Traitement à part | défis solo : supprimés avec preuves, votes et recours ; défis d'équipe partagés : conservés, preuve effacée |
| `TowerChallengeAttemptParticipant.userId` | Supprimé | participation de la personne à des défis |
| `TowerChallengeVote.userId` | Supprimé | votes de preuves de la personne |
| `TowerChallengeProgress.userId` | Supprimé | progression Tower de la personne |
| `TowerChallengeReplacement.userId` | Supprimé | remplacements de défis de la personne |
| `TowerChallengeAppeal.arbiterUserId` | Conservé | recours arbitré par la personne (NoAction) : décision conservée |
| `TowerChallengeProposal.proposerId` | Conservé | proposition de défi au catalogue : contenu partagé, sans lien identifiant |
| `TowerChallengeProposal.decidedById` | Conservé | décision ou action visant d'autres membres : conservée, rattachée au compte anonymisé |
| `TowerSeasonAward.userId` | Supprimé | titre et cadre cosmétiques de la personne |
| `TowerSeasonVoteBallot.voterUserId` | Supprimé | bulletin de la personne |
| `TowerSeasonVoteBallot.candidateUserId` | Conservé | bulletin d'un autre membre pour la personne |
| `TowerIrregularGrant.userId` | Supprimé | grade Irregular de la personne |
| `TowerIrregularGrant.grantedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `TowerIrregularGrant.revokedById` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `TowerIrregularLog.userId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `TowerIrregularLog.actorId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `UserProfileVisibility.userId` | Supprimé | réglage de visibilité du profil |
| `UserProfileEffectsPreference.userId` | Supprimé | préférence d'effets de profil |
| `ProfileEntitlement.userId` | Supprimé | droits cosmétiques du profil |
| `ProfileCustomization.userId` | Supprimé | personnalisation du profil |

### Champs-identifiants sans clé étrangère

| Champ | Traitement | Raison |
| --- | --- | --- |
| `CreationIntent.actorId` | Supprimé | reçu d'idempotence de la personne |
| `CommunityMemberCosmetic.userId` | Supprimé | cosmétiques achetés en XP par la personne |
| `SessionAvailabilityPollResponse.userId` | Supprimé | réponses de la personne aux sondages |
| `TournamentPrediction.voterId` | Supprimé | pronostics de tournoi de la personne |
| `TournamentPrediction.predictedUserId` | Conservé | pronostic d'un autre membre |
| `TournamentTeamMember.userId` | Conservé | équipe de tournoi : rattachée au participant conservé |
| `TowerChallengeAppeal.authorUserId` | Supprimé | recours déposés par la personne (texte libre) |
| `TowerChallengeAppeal.reviewerUserId` | Conservé | examen par le staff : identifiant opaque |
| `TowerChallengeAttempt.doubtReportedByUserId` | Neutralisé | mis à NULL : signalement de doute de la personne |
| `TowerSeasonVote.candidateUserIds` | Conservé | liste d'identifiants opaques de candidats |
| `TowerArbiterConfigurationChange.previousArbiterUserId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `TowerArbiterConfigurationChange.arbiterUserId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `TowerArbiterConfigurationChange.changedByUserId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `Session.notifiedUserIds` | Conservé | liste d'identifiants opaques déjà notifiés |
| `Roulette.notifiedUserIds` | Conservé | liste d'identifiants opaques déjà notifiés |
| `InstantSession.notifiedUserIds` | Conservé | liste d'identifiants opaques déjà notifiés |
| `Tournament.notifiedUserIds` | Conservé | liste d'identifiants opaques déjà notifiés |
| `XpAdjustment.userId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `XpAdjustment.userName` | Neutralisé | copie du pseudo remplacée par « Ancien membre » |
| `XpAdjustment.adminId` | Conservé | journal d'audit conservé sans lien identifiant (le compte est anonymisé) |
| `XpAdjustment.adminName` | Neutralisé | copie du pseudo de l'administrateur remplacée par « Ancien membre » |
| `NotificationEvent.payload` | Neutralisé | JSON libre : pseudo, identifiant Discord et mentions neutralisés |
| `MonthlyRecap.data` | Neutralisé | récap mensuel figé : pseudos neutralisés |
| `ModerationReport.authorDiscordId` | Neutralisé | identifiant Discord remplacé ; l'extrait du message de la personne est effacé |
| `ModerationReport.reporterDiscordId` | Neutralisé | identifiant Discord remplacé par un jeton neutre |
| `DiscordRoleRequest.requesterDiscordId` | Neutralisé | identifiant Discord remplacé par un jeton neutre |
| `Community.installedByDiscordId` | Neutralisé | mis à NULL : identifiant Discord de la personne qui a installé le bot |
| `Community.activatedById` | Conservé | identifiant opaque du compte qui a activé la communauté |
| `BoosterSupport.discordId` | Supprimé (voir clé étrangère) | ligne supprimée avec le soutien (BoosterSupport.userId) |
| `AccountDeletionLog.userId` | Conservé | journal de suppression sans donnée personnelle (identifiant opaque + compteurs) |

Textes libres neutralisés (pseudo et identifiant Discord remplacés par « Ancien membre », dans les lignes d'autres membres) : `Notification.title/message`, `Debt.reason/gage`, `NotificationDelivery.lastError`, `ModerationReport.excerpt`, et les JSON `NotificationEvent.payload`, `MonthlyRecap.data` (chaînes uniquement, jamais les clés). Les livraisons Discord vers la personne (`recipientKey = user:<id>`) sont supprimées : rien n'est envoyé au compte anonymisé.

Colonnes de `User` : toutes neutralisées par `tombstoneUserData`, sauf `id`, `createdAt`, `onboardingCompleted`, `soundEnabled` (booléens sans identifiant) et `colorCustomized` (remis à `false`) ; même garde de test.

### Défis Tower

`TowerChallengeAttempt` : un défi **solo** de la personne est supprimé avec ses votes, son recours et ses remplacements. Un défi **partagé** avec d'autres participants est conservé (pour eux), la personne en est retirée comme participante, le texte et le code de preuve sont effacés (`proofText` devient « [supprimé] » car une contrainte de base exige une preuve non nulle sur un défi soumis). `doubtReportedByUserId` est mis à `NULL`.

## Migration

`20261121100000_account_deletion_log` : **une seule nouvelle table**, `AccountDeletionLog` (identifiant, identifiant opaque du compte, compteurs JSON, date), sans clé étrangère, additive, aucune table existante modifiée. Appliquée automatiquement après fusion dans `main` par `.github/workflows/migrate-production.yml`, jamais au build ([MIGRATIONS.md](MIGRATIONS.md)). Aucune colonne n'est ajoutée à `User` : une colonne de plus aurait fait lire une colonne absente à toutes les requêtes `User` pendant la fenêtre « nouveau code, ancien schéma ».

**Ordre** : migration appliquée et vérifiée **avant** d'allumer `ACCOUNT_DELETION_ENABLED` (flag éteint, le code ne lit jamais la table). Allumé sans la migration, la suppression échoue (erreur Prisma `P2021`, table absente) **avant** toute suppression de fichier ou de ligne : rien n'est modifié.

## Tests

- `src/lib/account-deletion-plan.test.ts` : couverture exhaustive du schéma (relations, identifiants, colonnes `User`), absence de blocage par clé étrangère, outils de neutralisation.
- `src/lib/account-deletion.integration.test.ts` (Postgres local, `TEST_DATABASE_URL`) : aucune ligne de **toute la base** (scan de toutes les colonnes texte, JSON et tableaux) ne contient plus l'identifiant Discord, le pseudo, l'avatar, les jetons, les clés push ni les identifiants de plateformes ; second utilisateur et seconde communauté intacts (octet pour octet) ; fichiers Blob ; défis Tower ; refus du dernier OWNER ; idempotence ; reconnexion en nouveau compte sans conflit d'unicité ; export limité à la personne.
- `src/app/profil/compte/actions.test.ts`, `page.test.tsx`, `src/app/api/compte/export/route.test.ts`, `src/lib/account-deletion-flag.test.ts` : flag éteint = refus serveur, confirmation forte, identifiant forgé ignoré, export authentifié.

## Procédure manuelle de secours (flag éteint ou demande hors application)

Sans l'interrupteur, une demande d'effacement reçue par l'équipe se traite par un administrateur de base avec **la même routine** : `deleteAccount(<userId>)` de `src/lib/account-deletion.ts` (aucun script SQL à écrire à la main : une suppression de la ligne `User` échouerait). À défaut, ne **jamais** exécuter `DELETE FROM "User"`. Délai de réponse recommandé : un mois (RGPD art. 12). Pour l'export, `buildAccountExport(<userId>)` de `src/lib/account-export.ts`.

## Décisions laissées au propriétaire

- Délai de purge automatique des anciens membres (`Membership` `LEFT`/`REMOVED`, constat V1-10) : non traité ici.
- Transfert de propriété automatique d'une communauté : non traité (refus explicite à la place).
- Suppression ou conservation des contenus créés pour d'autres (soirées, tournois) : conservés ici, anonymisés ; une suppression en cascade reste possible plus tard par ADMIN.
- Pages légales et pied de page : hors de cette PR (traités à part) ; ils devront renvoyer vers `/profil/compte` une fois l'interrupteur allumé.
