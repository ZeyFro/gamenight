# Couverture du cahier des charges The Tower 2.0 — comparaison avec le code de `main` (20/11/2026)

Méthode : chaque exigence de `docs/CAHIER_DES_CHARGES.md` (§1 à §27, décisions du 17 et du 18/11 comprises) a été relue contre le code de `main` (`aa63a91`). Pour chaque ligne, les fichiers cités ont été vérifiés un par un (le script de génération échoue si un chemin n'existe pas). **Aucune exécution de recette** : « testée » veut dire qu'au moins un fichier de test du dépôt exerce le module (tests unitaires ou d'intégration Postgres, exécutés par la CI), pas que la fonction a été vue fonctionner dans Discord ou en Production.

## Conclusion : les nombres exacts

Une **exigence** = une ligne du tableau : un sous-paragraphe du cahier, découpé en plusieurs lignes quand il contient des exigences distinctes qui n'ont pas le même statut (exemple : §11.2 donne une ligne « fiche d'équipe » et une ligne « identité visuelle »). Les 15 sujets A à O du §27.2 comptent chacun pour une ligne.

| Statut | Nombre |
| --- | ---: |
| Implémentée dans le code : **oui** | 78 |
| Implémentée dans le code : **partielle** | 11 |
| Implémentée dans le code : **non** | 5 |
| **Reportée** (v2, plus tard, option future ou exclue) | 9 |
| **Sans livrable code** (principe, contenu éditorial, action Discord ou humaine) | 24 |
| **Total des lignes** | **127** |

Calcul : 78 oui + 11 partielles + 5 non = **94 exigences logicielles** ; 94 + 9 reportées + 24 sans livrable code = **127**.

Tests : sur les 89 exigences implémentées (78 oui + 11 partielles), **83 sont testées** et **6 ne le sont pas** (89 = 83 + 6). Les 6 non testées sont signalées « non » dans la colonne Testée.

Non comptés pour éviter les doubles comptes : §23 (phases de réalisation, qui reprennent des exigences déjà listées), §25 (les 17 conditions de livraison, suivies dans [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md) : 0 cochée), §26 (décisions ouvertes, toutes tranchées dans `docs/DECISIONS_TOWER.md`), §27.1 (reprend les sujets A à O) et §27.5 (même sujet que la ligne §6.3 « suppression des 134 rôles Étage »).

Les estimations de temps sont des **estimations de développement, non mesurées** (en jours d'une personne, hors revue et CI).

## Trous trouvés dans le code

1. **`DISCORD_ROLE_SELF_CREATION_ENABLED` était actif par défaut** (§27.6) : **corrigé**. Il est maintenant fermé tant que la valeur n'est pas exactement `true` (`roleCreationAllowed`, `src/lib/discord-role-command.ts`), avec des tests (`discord-role-command.test.ts`) ; `.env.example`, `CLAUDE.md` et `docs/obsidian/DISCORD-role-v1.md` sont alignés.
2. **`/role` écrit sur Discord en direct** (§27.6, « jamais en direct ») : l'attribution d'un rôle existant (PUT idempotent) reste directe, et la création directe n'est possible que si `DISCORD_ROLE_SELF_CREATION_ENABLED=true` et `DISCORD_ROLE_AUTOCREATE_ENABLED` éteint ; le chemin est borné (3 créations par heure et par joueur, verrou, plafond de rôles). Faire passer tout par la file : 1–2 j.

Aucune autre PR de code n'a été ouverte : le point 2 ne touche rien tant que `/role` reste éteint.

## Exigences logicielles (oui / partielle / non)

| § | Exigence | Code | Interrupteur | Testée | Preuve |
| --- | --- | :---: | --- | :---: | --- |
| 1.4 | Budget gratuit : fonctions essentielles sans Nitro, boost ni service payant | **oui** | DISCORD_BOOSTERS_ENABLED (cosmétique seulement) | non | `booster-support.ts` |
| 2.1 | Expérience quotidienne accessible depuis Discord (commandes, boutons, modales) | **oui** | TOWER_CHALLENGES_ENABLED | oui | `discord-tower-challenges.ts`, `scripts/discord-commands.json`, `discord-commands-manifest.test.ts` |
| 2.2 | Actions GameNight → Discord sans doublon, interactions Discord → GameNight | **oui** | NOTIFICATION_EXECUTOR_ENABLED | oui | `notification-delivery.ts`, `notification-executor.ts`, `notification-executor.integration.test.ts` |
| 2.3 | Connexion non obligatoire pour Discord, obligatoire pour les fonctions avancées | **oui** | aucun (connexion fermée S0 toujours active) | oui | `src/auth.ts`, `s0-access-controls.integration.test.ts` |
| 3.1 | Sept espaces et organisation du serveur | **partielle** | aucun (simulation seulement) | oui | `tower-discord-layout.json`, `scripts/provision-tower-layout.mjs`, `tower-layout-dryrun.test.ts` |
| 4.1–4.2 | Accueil immersif et parcours sans GameNight (panneau à 3 boutons) | **oui** | TOWER_ONBOARDING_PANEL_ENABLED | oui | `tower-onboarding-panel.ts`, `tower-onboarding-panel.test.ts` |
| 4.4 | Sélection de jeux et d'intérêts modernisée plutôt que dupliquée (/role) | **oui** | DISCORD_ROLE_COMMAND_ENABLED | oui | `discord-role-command.ts`, `discord-role-command.test.ts` |
| 6.1 | Grades Régulars / Irregular / Ranker / High Ranker | **oui** | TOWER_CHALLENGES_ENABLED ; TOWER_IRREGULAR_GRANTS_ENABLED (Irregular manuel) | oui | `tower-ranks.ts`, `tower-ranks.test.ts`, `tower-irregular-rules.ts` |
| 6.2 | Séparation des pouvoirs : un grade ne donne aucun droit d'administration | **oui** | aucun | non | `tower-ranks.ts` |
| 6.3 | Aucun nouveau rôle Discord permanent par étage | **oui** | aucun | non | `scripts/audit-tower-etage-roles.mjs`, `tower-etage-roles.test.ts` |
| 6.4 | Examen distinct des rôles techniques et historiques (admins, modération, jeux, bots, équipes, sanctions, notifications, obsolètes) | **partielle** | aucun | oui | `scripts/audit-tower-etage-roles.mjs`, `tower-etage-roles.test.ts`, `docs/TOWER_ROLE_REVIEW.md` |
| 7.1 | Étages infinis, stockés en base, affichés par le bot | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-personal-progress.ts`, `tower-challenges.integration.test.ts` |
| 7.2 | Le compteur démarre de zéro sans effacer les profils ni les historiques | **oui** | TOWER_CHALLENGES_ENABLED | non | `tower-challenges.ts` |
| 7.3 | Étages obtenus par défis, barème +1 / +2 / +3, pas de double attribution | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenges.ts`, `tower-s1-catalogue.test.ts`, `tower-challenges.integration.test.ts` |
| 7.4 | Progression permanente entre saisons, arrivants tardifs sans rattrapage | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-standings.ts`, `tower-standings.test.ts` |
| 8.2 | Bouton « Mon défi », 1 attribution toutes les 12 h, 48 h pour réaliser | **oui** | TOWER_CHALLENGES_ENABLED | oui | `discord-tower-challenges.ts`, `tower-challenge-rules.ts`, `tower-challenge-rules.test.ts` |
| 8.3 | Défi d'équipe quotidien automatique, éligibilité et anti-abus | **oui** | TOWER_TEAM_DAILY_ENABLED (+ TOWER_CHALLENGES_ENABLED, communityTeamsEnabled) | oui | `tower-team-daily.ts`, `.github/workflows/tower-team-daily.yml`, `tower-team-daily.regression.integration.test.ts` |
| 8.4 | Deux réussites validées par jour au plus, même sous validations simultanées | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenge-rules.ts`, `tower-challenge-rules.test.ts`, `tower-challenges.integration.test.ts` |
| 8.5 | Variété des défis (gaming, créatifs, absurdes, coopération, hors jeu…) | **partielle** | aucun | oui | `tower-s1-solo-catalogue.ts`, `tower-s1-team-catalogue.ts`, `tower-s1-catalogue.test.ts` |
| 8.6 | Remplacement d'un défi si le jeu n'est pas possédé ; aucun achat obligatoire | **oui** | TOWER_CHALLENGE_REPLACEMENT_ENABLED | oui | `tower-challenge-replacement.ts`, `tower-challenge-replacement.integration.test.ts` |
| 8.7 | Propositions de défis par les grades élevés (≥ Ranker) | **oui** | TOWER_CHALLENGE_PROPOSALS_ENABLED | oui | `tower-challenge-proposals.ts`, `tower-challenge-proposal-rules.ts`, `tower-challenge-proposals.integration.test.ts` |
| 9.1 | Dépôt de preuve postérieur à l'attribution, avec code de preuve et consentement de publication | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenge-proof-rules.ts`, `tower-challenge-proof-rules.test.ts`, `tower-challenges.integration.test.ts` |
| 9.1 | Les défis qui autorisent des preuves anciennes doivent l'indiquer explicitement | **non** | aucun | — | — |
| 9.2 | Vote 24 h, 3 votants distincts, majorité stricte, pas d'auto-vote, égalité = refus, sans quorum : prolongation unique de 24 h puis rejet | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenge-voting.ts`, `tower-challenge-voting.test.ts` |
| 9.3 | Contestations publiques et anti-abus (votes multiples, rejeux, non autorisés, double récompense, abus d'équipe) | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenge-appeal-rules.ts`, `tower-challenge-appeal-rules.test.ts`, `tower-challenges.integration.test.ts` |
| 9.4 | Aucune IA ne valide une preuve | **oui** | aucun | non | `tower-challenges.ts` |
| 10.1 | Annonce automatique des réussites (joueur ou équipe, défi, preuve publiable, difficulté, récompense, étage) | **oui** | TOWER_DISCORD_ANNOUNCE_ENABLED | oui | `tower-challenge-announcements.ts`, `tower-challenge-announcements.test.ts` |
| 10.2 | Information de publication au dépôt, données personnelles non exposées | **oui** | TOWER_DISCORD_ANNOUNCE_ENABLED | oui | `tower-challenge-announcements.ts`, `tower-challenges.integration.test.ts` |
| 10.3 | Animation : réussites marquantes, exploits insolites, distinctions humoristiques, résultats de compétitions, récapitulatifs hebdomadaires, mise en avant des joueurs actifs | **partielle** | COMMUNITY_HIGHLIGHTS_ENABLED (exploits) | oui | `community-highlights.ts`, `superlative-voting.ts`, `community-highlights.test.ts` |
| 11.1 | Découvrir, créer, rejoindre une équipe, candidater, recruter | **oui** | TEAM_APPLICATIONS_ENABLED ; TEAM_RECRUITERS_ENABLED (le socle n'a pas d'interrupteur) | oui | `community-teams.ts`, `team-recruiters-rules.ts`, `team-recruiters-rules.test.ts` |
| 11.2 | Fiche d'équipe : nom, présentation, capitaine, membres, jeux, objectifs, critères de recrutement, rendez-vous | **oui** | TEAM_RECRUITMENT_CRITERIA_ENABLED (critères) | oui | `community-teams.ts`, `community-teams-rules.test.ts` |
| 11.2 | Identité visuelle d'une équipe | **non** | aucun | — | — |
| 11.3 | Forums existants (recherche de joueurs, recrutement, projets) avec tags | **oui** | aucun | oui | `tower-forums.ts`, `tower-forums.test.ts`, `src/app/tower/forums/page.test.tsx` |
| 11.4 | Équipes conservées dans GameNight : 2 à 8 membres, équipe unique, capitaine | **oui** | aucun (communityTeamsEnabled) | oui | `community-teams-rules.ts`, `community-teams-rules.test.ts` |
| 12.2 | Critères de recherche : jeux, plateformes, disponibilités, mode compétitif ou détente, niveau | **oui** | GAME_LEVELS_ENABLED ; GAME_LEVELS_MATCHMAKING_ENABLED ; playerClassifiedsEnabled | oui | `player-classifieds.ts`, `player-classified-filters.ts`, `game-levels-matchmaking.ts` |
| 12.2 | Critères de recherche : langue, préférences communautaires, habitudes de jeu, centres d'intérêt | **partielle** | aucun | oui | `player-classified-filters.ts` |
| 12.3 | Parcours « Qui joue ce soir ? », « Je cherche une partie », recherche par jeu, profils publics, recrutement | **oui** | WHO_PLAYS_TONIGHT_ENABLED | oui | `tonight-rules.ts`, `tonight.integration.test.ts`, `player-classifieds.ts` |
| 12.3 | Proposition de partenaires compatibles | **non** | aucun | — | — |
| 12.3 | Découverte des joueurs respectant leur choix de visibilité | **partielle** | PROFILE_VISIBILITY_ENABLED | oui | `profile-visibility.ts`, `profile-visibility.test.ts` |
| 12.4 | Profil : jeux favoris, plateformes, niveaux, disponibilités, préférences, tier list, historique | **oui** | GAME_PLATFORMS_ENABLED ; GAME_LEVELS_ENABLED | oui | `game-platforms.ts`, `game-platforms.test.ts`, `game-levels-rules.ts` |
| 13.1 | Soirées : création, jeux, disponibilités, inscriptions, votes, rappels, annonces, coordination | **oui** | DISCORD_BOT_SESSION_ANNOUNCE_ENABLED (annonces) ; le socle n'a pas d'interrupteur | oui | `sessions.ts`, `session-announce.integration.test.ts` |
| 13.2 | Calendrier communautaire sans second bot | **oui** | CALENDAR_SUBSCRIPTIONS_ENABLED (abonnement iCal) | oui | `calendar-feed.ts`, `calendar-feed.integration.test.ts` |
| 13.3 | Tournois : inscriptions, règles, participants, résultats, annonces, classements | **oui** | TOURNAMENT_SCORES_ENABLED (scores) ; le socle n'a pas d'interrupteur | oui | `tournament-announce.integration.test.ts` |
| 13.4 | Interfaces : « Ce soir », fiches de soirée, recherche de partie, roulette, calendrier, notifications personnalisées | **oui** | WHO_PLAYS_TONIGHT_ENABLED ; NOTIFICATION_CENTER_ENABLED | oui | `roulette-draw.ts`, `session-rsvp-components.ts`, `game-ping-optin.ts` |
| 14.1 | Saisons accessibles aux arrivants tardifs | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-challenge-seasons.ts`, `tower-standings.ts` |
| 14.2 | Calendrier scolaire et saison d'été (S1 du 1er décembre au 31 mars, avril–juin, été, septembre–novembre) | **oui** | aucun | oui | `tower-challenge-seasons.ts`, `tower-challenge-seasons.test.ts` |
| 14.3 | Classements individuel, saisonnier, permanent, historique, distinctions | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-standings.ts`, `tower-standings.test.ts`, `tower-season-podium.ts` |
| 14.3 | Classement d'équipes | **non** | TEAM_RIVALRIES_ENABLED (bilans de rivalités seulement) | — | — |
| 14.4 | Réinitialisation saisonnière, étages conservés, historique, pas de salon par saison | **oui** | TOWER_CHALLENGES_ENABLED | oui | `tower-season-rules.ts`, `tower-challenges.integration.test.ts` |
| 15.1 | Récompenses : badges, titres, grades cosmétiques, distinctions de saison, Hall of Fame, proposer des défis, choisir des événements, distinctions humoristiques, exploits collectifs | **oui** | TOWER_SEASON_AWARDS_ENABLED ; PROFILE_CUSTOMIZATION_ENABLED | oui | `tower-season-podium.ts`, `src/app/tower/palmares/page.tsx`, `profile-customization.ts` |
| 15.2 | Aucun droit d'administration par récompense ; aucun cadeau payant sans budget | **oui** | aucun | oui | `profile-customization.test.ts` |
| 16 | Le Sommet : classements, Hall of Fame, Rankers, défis entre équipes, distinctions, exploits, sur des données réelles | **oui** | TOWER_CHALLENGES_ENABLED ; TEAM_RIVALRIES_ENABLED | oui | `src/app/tower/palmares/page.tsx`, `tower-standings.ts`, `team-rivalries.ts` |
| 17 | Salons vocaux : groupes de jeu, équipes, événements, vocaux temporaires | **partielle** | SESSION_VISIBILITY_ENABLED ; DISCORD_TEAM_SPACES_ENABLED | oui | `session-visibility.ts`, `session-visibility.integration.test.ts`, `discord-team-spaces.ts` |
| 19.1 | Permissions cohérentes, administrateurs vérifiés, salons privés protégés | **oui** | aucun | oui | `discord-setup-permissions.ts`, `tower-layout-permissions.test.ts`, `s0-access-controls.integration.test.ts` |
| 19.1 | Journalisation des opérations sensibles | **partielle** | aucun | oui | `tower-challenges.integration.test.ts` |
| 19.2 | Rôles de prestige séparés des rôles techniques ; permissions sensibles vérifiées avant application | **oui** | aucun | oui | `discord-setup-permissions.ts`, `tower-layout-permissions.test.ts` |
| 19.3 | Confidentialité des preuves, tickets et journaux de modération | **oui** | DISCORD_REPORT_COMMAND_ENABLED ; TOWER_DISCORD_ANNOUNCE_ENABLED | oui | `discord-report-command.ts`, `discord-report-command.test.ts` |
| 19.4 | Anti-abus : récompenses multiples, votes frauduleux, validations doubles, participation artificielle, exploitation d'interactions, accès inter-communautés | **oui** | COMMUNITY_ISOLATION_ENABLED (garde Membership toujours active) | oui | `tower-challenges.integration.test.ts`, `community-scope.test.ts`, `s0-access-controls.integration.test.ts` |
| 21.2 | Bot : commandes, boutons, menus, défis, preuves, votes, progression, événements, notifications | **partielle** | TOWER_CHALLENGES_ENABLED | oui | `discord-tower-challenges.ts`, `discord-tower-challenges.test.ts` |
| 21.3 | Base de données : membres, équipes, défis, attributions, preuves, votes, récompenses, étages, saisons, classements, historiques ; opérations idempotentes et concurrentes | **oui** | aucun | oui | `prisma/schema.prisma`, `tower-challenges.integration.test.ts` |
| 21.4 | Migrations : structure vérifiée, sauvegarde, tests, retour arrière, validation de la bascule | **partielle** | aucun | oui | `docs/MIGRATIONS.md`, `.github/workflows/migrate-production.yml`, `migrations-immutable.test.ts` |
| 21.5 | Environnements distincts, aucune donnée de production en test | **oui** | aucun | oui | `notification-executor.preview.test.ts`, `tower-challenges.integration.test.ts` |
| 22.2 | Test : limite de 12 h entre deux attributions solo | **oui** | aucun | oui | `tower-challenge-rules.test.ts` |
| 22.2 | Test : expiration des défis à 48 h | **oui** | aucun | oui | `tower-challenge-rules.test.ts` |
| 22.2 | Test : deux réussites maximum par jour | **oui** | aucun | oui | `tower-challenge-rules.test.ts` |
| 22.2 | Test : votes de 24 h | **oui** | aucun | oui | `tower-challenge-voting.test.ts` |
| 22.2 | Test : minimum de trois votants | **oui** | aucun | oui | `tower-challenge-voting.test.ts` |
| 22.2 | Test : majorité réelle | **oui** | aucun | oui | `tower-challenge-voting.test.ts` |
| 22.2 | Test : égalités et absence de quorum | **oui** | aucun | oui | `tower-challenge-voting.test.ts` |
| 22.2 | Test : contestations | **oui** | aucun | oui | `tower-challenge-appeal-rules.test.ts`, `tower-challenges.integration.test.ts` |
| 22.2 | Test : récompense attribuée une seule fois | **oui** | aucun | oui | `tower-challenges.integration.test.ts` |
| 22.2 | Test : attributions simultanées | **oui** | aucun | oui | `tower-challenges.integration.test.ts` |
| 22.2 | Test : permissions | **oui** | aucun | oui | `s0-access-controls.integration.test.ts`, `community-scope.test.ts` |
| 22.2 | Test : isolation des communautés | **oui** | aucun | oui | `community-scope.test.ts`, `s0-access-controls.integration.test.ts` |
| 22.2 | Test : bascule depuis les anciens étages | **non** | aucun | — | — |
| 24 | Notifications configurables | **oui** | NOTIFICATION_CENTER_ENABLED (+ préférences existantes) | oui | `notification-preferences.test.ts`, `notification-channel-preferences.ts`, `game-ping-optin.test.ts` |
| 27 A | Équipes : recruteurs (≤ 2), invités de tournoi, relance 48 h, expiration 7 j, 8 joueurs max [#479] | **oui** | TEAM_RECRUITERS_ENABLED (migration team_recruiters_guest) | oui | `team-recruiters-rules.ts`, `team-recruiters-rules.test.ts` |
| 27 B | Votes de preuves dans Discord : boutons ✅/❌, fil par preuve, votants ≥ 7 jours [#476] | **oui** | TOWER_DISCORD_VOTES_ENABLED (sans migration) | oui | `tower-challenge-announcements.ts`, `tower-vote-eligibility.test.ts`, `tower-discord-votes.integration.test.ts` |
| 27 C | Validation automatique Steam, repli sur le vote, « Signaler un doute » [#484] | **oui** | TOWER_STEAM_AUTOVALIDATE_ENABLED (migration tower_challenge_measure) | oui | `tower-steam-measure.ts`, `tower-steam-measure.integration.test.ts` |
| 27 D | Soirées publique / candidature / privée, liste d'attente, espace temporaire [#480] | **oui** | SESSION_VISIBILITY_ENABLED (migration session_visibility_waitlist) | oui | `session-visibility.ts`, `session-visibility.test.ts`, `session-visibility.integration.test.ts` |
| 27 E | Tournois par équipes, score confirmé par les 2 capitaines, équilibrage par niveau [#488] | **oui** | TOURNAMENT_TEAMS_ENABLED (migration tournament_teams) | oui | `tournament-teams-rules.ts`, `tournament-teams-rules.test.ts` |
| 27 F | /role : création automatique de rôles via la file, 1 par joueur et par semaine, alerte à 80 % [#475] | **oui** | DISCORD_ROLE_AUTOCREATE_ENABLED (migration discord_role_requests) | oui | `discord-role-autocreate.ts`, `notification-executor-role-autocreate.test.ts` |
| 27 G | /projet : organisateur, date de fin, fils, archivage à 7 jours [#485] | **oui** | PROJECT_ORGANIZER_ENABLED (migration project_entries) | oui | `projects.ts`, `projects.integration.test.ts`, `project-space-service.test.ts` |
| 27 H | « Jouer maintenant » (Rejoindre / Intéressé, 2 h) et rivalités d'équipes [#487] | **oui** | TEAM_RIVALRIES_ENABLED (migration team_rivalries) | oui | `team-rivalries.ts`, `team-rivalries-rules.test.ts`, `team-rivalries.integration.test.ts` |
| 27 I | Notifications : MP ciblés, pings de rôle opt-in, centre in-app, jamais @everyone [#474] | **oui** | NOTIFICATION_CENTER_ENABLED (migration notification_center) | oui | `notification-policy.ts`, `notification-policy.test.ts`, `game-ping-optin.test.ts` |
| 27 J | Console : scope OAuth connections, identifiants préremplis, plateformes, crossplay [#481] | **oui** | DISCORD_CONNECTIONS_SCOPE_ENABLED ; GAME_PLATFORMS_ENABLED (migration platform_identities_crossplay) | oui | `discord-connections.ts`, `discord-connections.test.ts`, `game-platforms.test.ts` |
| 27 K | Niveau par jeu et matchmaking (Débutant / Intermédiaire / Confirmé / Compétitif) [#468, #482] | **oui** | GAME_LEVELS_ENABLED ; GAME_LEVELS_MATCHMAKING_ENABLED (migration user_game_levels) | oui | `game-levels-rules.ts`, `game-levels-matchmaking.ts`, `game-levels-matchmaking.integration.test.ts` |
| 27 L | Signalement contextuel : ticket privé staff, aucune sanction automatique [#478] | **oui** | DISCORD_REPORT_COMMAND_ENABLED (migration moderation_reports) | oui | `discord-report-command.ts`, `discord-report-command.test.ts` |
| 27 M | Boosters : rôle « Soutien de la Tour », mur des soutiens, salons boosters, retrait automatique [#483] | **oui** | DISCORD_BOOSTERS_ENABLED (migration booster_support) | oui | `booster-support.ts`, `booster-support.test.ts` |
| 27 N | Personnalisation du profil (couleurs, thèmes, cadres, effets, vitrine, entitlement sans paiement) [#477] | **oui** | PROFILE_CUSTOMIZATION_ENABLED (migration profile_customization) | oui | `profile-customization.ts`, `profile-customization.test.ts` |
| 27 O | Tableau de bord staff v2 en lecture seule [#486] | **oui** | ADMIN_DASHBOARD_V2_ENABLED (sans migration) | oui | `src/app/admin/tableau-de-bord/page.tsx` |
| 27.6 | Tous les interrupteurs sont OFF par défaut | **oui** | DISCORD_ROLE_SELF_CREATION_ENABLED (fermé sauf `true`) | oui | `discord-role-command.ts`, `discord-role-command.test.ts` |
| 27.6 | Les écritures Discord passent par la file et l'executor, jamais en direct | **partielle** | DISCORD_ROLE_COMMAND_ENABLED | oui | `discord-role-command.ts`, `discord-role-command.test.ts` |
| 27.6 | Aucune IA ne valide une preuve ; récompenses cosmétiques | **oui** | aucun | non | `tower-challenges.ts`, `profile-customization.ts` |

### Ce qui manque (16 lignes « partielle » ou « non »)

| § | Statut | Ce qui manque | Estimation |
| --- | :---: | --- | --- |
| 3.1 — Sept espaces et organisation du serveur | partielle | Le gabarit existe et se compare en simulation, mais rien ne l'applique au serveur (action manuelle ou script d'application à écrire) | 2–4 h à la main, ou ~1 j pour un script d'application avec accord |
| 6.4 — Examen distinct des rôles techniques et historiques (admins, modéra… | partielle | Seul l'inventaire des rôles Étage est outillé ; la revue des 145 rôles « review » et des 13 rôles ADMINISTRATOR reste une décision humaine | 1–2 j (humain) |
| 8.5 — Variété des défis (gaming, créatifs, absurdes, coopération, hors jeu…) | partielle | Catalogue de 116 défis codé et contrôlé sur les règles, mais sa variété n'est pas vérifiée par le code et `TOWER_SAISON1_CATALOGUE_30.md` décrit encore 30 défis | 0,5 j (relecture humaine) |
| 9.1 — Les défis qui autorisent des preuves anciennes doivent l'indiquer e… | non | Aucun champ ni règle dans la définition d'un défi : le code refuse toute preuve antérieure à l'attribution | 0,5–1 j |
| 10.3 — Animation : réussites marquantes, exploits insolites, distinctions … | partielle | Pas de récapitulatif hebdomadaire Tower automatique ni de mise en avant des joueurs actifs (le récap existant est annuel) | 2–3 j |
| 11.2 — Identité visuelle d'une équipe | non | Aucun champ logo, bannière ou couleur sur `CommunityTeam` (prisma/schema.prisma) | 1–2 j (migration additive + interface) |
| 12.2 — Critères de recherche : langue, préférences communautaires, habitud… | partielle | Pas de champ langue ni habitudes de jeu ; seuls les tags d'intérêt (`Tag`, `UserTag`) existent | 1–2 j |
| 12.3 — Proposition de partenaires compatibles | non | Aucune suggestion automatique : filtres manuels seulement | 3–5 j |
| 12.3 — Découverte des joueurs respectant leur choix de visibilité | partielle | La visibilité ne couvre que la liste Potes et les fiches ; classements et soirées ne la respectent pas | 2–3 j |
| 14.3 — Classement d'équipes | non | Aucun classement d'équipes Tower (seulement les bilans de rivalités par équipe) | 2–3 j |
| 17 — Salons vocaux : groupes de jeu, équipes, événements, vocaux tempora… | partielle | Vocaux temporaires seulement pour les soirées et les équipes ; pas de vocal temporaire communautaire libre | 3–5 j (+ vérification des bots existants) |
| 19.1 — Journalisation des opérations sensibles | partielle | Journaux ciblés (`TowerIrregularLog`, `TowerArbiterConfigurationChange`, `ModerationReport`) mais pas de journal général des opérations sensibles | 2–3 j |
| 21.2 — Bot : commandes, boutons, menus, défis, preuves, votes, progression… | partielle | Aucun menu déroulant (select menu) : boutons et modales seulement | ~1 j |
| 21.4 — Migrations : structure vérifiée, sauvegarde, tests, retour arrière,… | partielle | Aucune preuve de restauration dans le dépôt (la copie de branche n'est pas une restauration, `NEON_TEST_APPLY_REVIEW.md`) | 0,5–1 j (action propriétaire sur Neon) |
| 22.2 — Test : bascule depuis les anciens étages | non | Sans objet depuis la décision §7.2 (compteur à zéro) : aucune bascule n'est codée, donc rien à tester | 0 (sauf reprise des anciens étages : voir `SOIREE_ACTIVATION.md` §4 bis) |
| 27.6 — Les écritures Discord passent par la file et l'executor, jamais en … | partielle | L'attribution d'un rôle existant reste directe ; la création directe n'est possible que si `DISCORD_ROLE_SELF_CREATION_ENABLED=true` et la création automatique est éteinte (borné : 3 par heure et par joueur, verrou, plafond de rôles) | 1–2 j |

## Reportées (explicitement en v2, plus tard, option future ou exclues)

| § | Exigence | Motif |
| --- | --- | --- |
| 1.3 | Internationalisation (étapes à 10 000 puis 50 000 membres actifs) | Reportée : « pourra être envisagée lors de la croissance » |
| 20.1 | Concierge IA | « Option future » |
| 20.2 | IA pour les contenus | « Optionnel » |
| 20.3 | Validation IA des preuves | « Non retenue pour la version initiale » (exclue, voir aussi 9.4) |
| 20.4 | Discord Activities | « Proposition future, non obligatoire » |
| 20.5 | Améliorations visuelles Discord (tags, bannières, styles avancés) | « Options futures » |
| 27.3 | Bot gateway permanent (activité Discord, temps en vocal, « 3 membres jouent à X ») | Reporté en v2 (documentation seulement) |
| 27.3 | Rangs importés via API officielles (Riot, Hypixel) | Reporté en v2 (l'interface `source` DECLARED \| IMPORTED est prête, rien n'est importé) |
| 27.4 | VIP payant cosmétique et confort | Reporté « plus tard » (le champ d'entitlement existe, aucun paiement) |

## Sans livrable code (non comptées comme implémentation)

Principes, contenus éditoriaux, réglages Discord ou actions du propriétaire : elles ne se vérifient pas dans le dépôt.

| § | Exigence | Pourquoi hors code |
| --- | --- | --- |
| 1.1 | Vision : parcours complet du joueur (découvrir, partenaires, soirées, équipes, Tour, défis, grades, compétitions, réputation) | Énoncé de vision : chaque capacité est comptée dans les lignes suivantes |
| 1.2 | Multigaming : aucun jeu imposé | Principe de positionnement |
| 1.3 | Lancement prioritairement francophone | Stratégie de lancement |
| 1.3 | Ne pas annoncer le lancement comme terminé avant validation | Règle de communication |
| 3.2 | Principes d'organisation (noms, emojis, mobile, pas de salons vides, fils et panneaux) | Configuration Discord |
| 4.3 | Règlement et validation d'accès : vérifier le rôle Régulars, tester comme un vrai nouveau membre | Vérification humaine sur Discord |
| 4.4 | Onboarding natif Discord (option) | Option de configuration Discord, non obligatoire |
| 5.1 | Direction artistique (Tower of God, science-fiction, holographique, humour) | Jugement de design, non vérifiable par le code |
| 5.2 | Éléments visuels à harmoniser (icône, bannière, cartes, classements, annonces) | Ressources graphiques hors dépôt |
| 5.3 | Ton communautaire (convivial, bienveillant, sans humiliation) | Rédaction et modération |
| 6.3 | Suppression des 134 rôles Étage | Action manuelle du propriétaire : déclarée faite le 20/11, non vérifiable depuis le dépôt |
| 7.2 | Pas de deux sources concurrentes (arrêt de l'attribution d'étages d'Atlas) | Action manuelle dans Atlas ; GameNight n'écrit aucun rôle d'étage |
| 8.1 | Les défis encouragent découverte, coopération, créativité, humour | Contenu éditorial |
| 18.1 | Réutiliser et améliorer avant de remplacer | Principe |
| 18.2 | YAGPDB : préserver et moderniser la validation et la sélection de rôles | Bot tiers : audit documentaire seulement |
| 18.3 | Atlas : préparer le remplacement de l'attribution des étages | Bot tiers : pause manuelle |
| 18.4 | Ticket Tool : réparer et réutiliser le panneau d'assistance | Bot tiers : audit documentaire seulement |
| 18.5 | Appy : conserver son rôle dans les candidatures | Bot tiers |
| 18.6 | Modération : auditer avant de choisir les mécanismes | Audit humain ; le signalement contextuel est compté au sujet L |
| 19.1 | Protection anti-raid, anti-spam serveur et contrôle des bots et applications | Réglages Discord (AutoMod, vérification) et audit humain |
| 21.1 | Pas de système parallèle de profils, équipes ou progression | Principe d'architecture |
| 22.1 | Exigences générales (testable, documenté, vérifiable, mobile, sans effet sur les autres communautés) | Qualité transverse |
| 22.3 | Vérification sur le résultat réel (code ≠ fonction active, déploiement ≠ commande Discord) | Recette humaine |
| 24 | Développement communautaire (soirées hebdomadaires, créateurs, partenariats, réseaux sociaux) | Activité humaine |

## Écarts code / décisions du 17/11 — tous résolus sur `main`

| Règle décidée | Code de `main` | Fichier |
| --- | --- | --- |
| High Ranker : ≥ 100 étages + ≥ 5 défis validés sur la saison en cours | Aligné | `src/lib/tower-ranks.ts` |
| Couleurs : Régulars gris, Irregular violet, Ranker or, High Ranker rouge | Aligné (`#6b7280`, `#8b5cf6`, `#f59e0b`, `#dc2626`) | `src/lib/tower-ranks.ts` |
| Irregular = attribution manuelle staff ; Régulars dès l'inscription | Aligné ; attribution stockée (`TowerIrregularGrant`), derrière `TOWER_IRREGULAR_GRANTS_ENABLED` | `src/lib/tower-ranks.ts`, migration `20261118122000_tower_irregular_grants` |
| S1 du 01/12/2026 au 31/03/2027, puis avril–juin, été juillet–août, septembre–novembre | Aligné : 4 périodes couvrant l'année, plus d'intersaison | `src/lib/tower-challenge-seasons.ts` |
| Défi d'équipe attribué à 18:00 Europe/Paris | Aligné : cron `0 16,17 * * *` avec contrôle de l'heure de Paris | `.github/workflows/tower-team-daily.yml`, `docs/TOWER_TEAM_DAILY_CRON.md` |
| Sans quorum à 24 h : prolongation unique de 24 h puis rejet sans pénalité, une resoumission | Aligné | `src/lib/tower-challenge-voting.ts`, migration `20261118120000_tower_vote_extension_resubmission` |
| Contestation ouverte 48 h après la décision | Aligné (`TOWER_CHALLENGE_APPEAL_WINDOW_MS` = 48 h) | `src/lib/tower-challenge-appeal-rules.ts` |
| Équipes 2 à 8, équipe unique, délai 7 jours | Aligné (`maxMembers` 2–8) | `src/lib/community-teams-rules.ts`, migration `20261104140000_tower_team_membership_policy` |
| Récompenses cosmétiques uniquement ; le top 1 propose un défi pour la saison suivante | Inchangé ; s'ajoutent les propositions des Ranker / High Ranker validées par le staff. **À confirmer par le propriétaire** | `src/lib/tower-season-proposal.ts`, `TOWER_CHALLENGE_PROPOSALS_ENABLED` |

## Corrections par rapport à la version précédente

- Le sujet B (votes dans Discord) n'a **pas** de migration : le dossier `20261118130100_tower_vote_messages` n'existe pas dans `prisma/migrations/`.
- Sujet K : l'énumération est `DEBUTANT / INTERMEDIAIRE / CONFIRME / COMPETITIF` (`prisma/schema.prisma`) ; le dossier `20261118123100_user_game_levels` n'existe qu'en une seule copie.
- Les rôles « Étage » ont été supprimés à la main (déclaration du 20/11) : aucune donnée de GameNight n'en dépendait ; voir [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md), section 4 bis.
- **Neon : « Neon Test » ne désigne jamais le projet `misty-tooth-45335023`.** Ce projet (nom `gamenight`, branche par défaut `production`, `br-super-cell-b1ukvk08`) **est la Production**. Les environnements de test sont le projet `winter-scene-14323342` (« gamenight-restore-rehearsal ») et les branches `tower-migration-test-*` du projet `gamenight`. Les documents historiques `NEON_TEST_*.md`, `PLAN-MIGRATIONS.md` et `ETAT.md` écrivent « Neon Test » pour la **branche** `tower-migration-test-20261105`, jamais pour le projet entier : ne rien exécuter sur `misty-tooth-45335023` en pensant être sur un environnement de test (voir [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md), section 2).
