# The Tower 2.0 — décisions §26 (approuvées par le propriétaire le 17/11/2026)

> Décisions datées du 17/11/2026. Elles complètent `docs/CAHIER_DES_CHARGES.md` (§26) et prévalent sur `docs/TOWER_DECISIONS_26_20261104.md` en cas de contradiction (les écarts de code constatés sont suivis dans `docs/COUVERTURE_CAHIER.md`). Document d'alignement : aucune règle n'est déployée par cette PR.

- **Barème** : facile +1, moyen +2, difficile +3 étages. Étages permanents.
- **Grades** : Régulars dès l'inscription ; Irregular = attribution manuelle staff (prestige, aucun droit) ; Ranker ≥ 30 étages ; High Ranker ≥ 100 étages + au moins 5 défis validés sur la saison en cours. Aucun grade ne donne de droit de modération.
- **Couleurs** : Régulars gris, Irregular violet, Ranker or, High Ranker rouge.
- **Équipes** : 2 à 8 joueurs, 1 seule équipe principale par joueur et par communauté, délai de 7 jours avant de rejoindre une autre équipe, création libre pour tout membre GameNight actif, le créateur est capitaine.
- **Défis solo** : 1 attribution max toutes les 12 h, 48 h pour réaliser, max 2 réussites validées par jour (solo + équipe). **Défi d'équipe** : 1 par jour, attribution à 18:00 Europe/Paris.
- **Votes** : 24 h, min 3 votants distincts, majorité stricte, pas de vote sur sa propre preuve, égalité = non validé. Sans quorum à 24 h : prolongation unique de 24 h, puis rejet sans pénalité (le joueur peut resoumettre une fois).
- **Contestation** : ouverte 48 h après la décision, tranchée par l'arbitre fixe (#407), 1 contestation par défi.
- **Saisons** : S1 du 1er décembre 2026 au 31 mars 2027 ; puis avril–juin, saison été juillet–août, septembre–novembre.
- **Départage des classements** : 1) étages, 2) nombre de défis difficiles, 3) date d'atteinte la plus ancienne.
- **Récompenses** : uniquement cosmétiques (titres, badges, cadres, distinctions saisonnières), durée = saison suivante. Aucune récompense payante ni administrative.
- **Onboarding** : Discord d'abord, GameNight seulement pour équipes/progression/inscriptions (cahier §4).
- **Lancement public** : semaine du 1er décembre 2026. Extensions facultatives (IA d'orientation, salons vocaux temporaires) : hors périmètre v1.

---

# The Tower 2.0 — parcours Discord et personnalisation v1.1 (décisions du propriétaire du 18/11/2026)

> Décisions datées du 18/11/2026. Elles s'ajoutent à celles du 17/11/2026 ci-dessus, qui restent inchangées, et sont détaillées dans `docs/CAHIER_DES_CHARGES.md` (§27). Document d'alignement : rien n'est déployé par cette PR. Marqueurs : **v1** (v1.1 prévue) · **v2** · **plus tard**.

- **Console** (**v1**, sujets J) : À la connexion Discord, demander le scope OAuth `connections` (consentement explicite, optionnel) ; préremplir plateformes et identifiants (xbox, playstation, epicgames, battlenet, riotgames, steam) dans les identifiants existants (L3-01), modifiables. Ajout rapide de jeux par plateforme (PC/PS/Xbox/Switch) et liste « populaires sur ta plateforme ». Champ crossplay sur la fiche jeu. Défis : ne jamais proposer à un joueur un défi impossible sur ses plateformes ; photo d'écran TV avec code de preuve acceptée.
- **Validation automatique** (**v1**, sujets C) : Défis « mesurables Steam » (delta de playtime depuis l'attribution, succès Steam) validés automatiquement par cron ; profil privé = repli sur le vote. Bouton « Signaler un doute » (membres éligibles) qui bascule en vote communautaire. MP au joueur à la validation.
- **Notifications** (**v1**, sujets I) : MP uniquement pour ce qui vise personnellement le joueur (invitation, candidature, son défi, contestation). Le reste : pings de rôle de jeu dans les salons (opt-in) + centre de notifications dans l'app (+ Web Push existant). Jamais @everyone. Annonces publiques seulement pour moments marquants (nouveau Ranker/High Ranker, victoire de tournoi, record).
- **Niveau par jeu** (**v1**, sujets K) : Niveau déclaratif (Débutant/Intermédiaire/Confirmé/Compétitif) sur le profil, utilisé par matchmaking et équilibrage de tournoi. Prévoir l'interface pour un rang importé plus tard.
- **Groupes** (**v1**, sujets A, D, E, G) : 1 équipe principale ; projets et soirées illimités ; participation à un tournoi comme invité d'une autre équipe autorisée.
- **Modération** (**v1**, sujets L) : Commande contextuelle « Signaler » sur un message → ticket privé staff (contexte, liens), aucune sanction auto, journalisé.
- **Boosters** (**v1**, sujets M) : Cron qui lit `premium_since` des membres (REST, sans gateway) ; rôle « Soutien de la Tour » sans permission, couleur, badge + cadre GameNight, page/salon « Mur des soutiens », accès à un salon écrit + vocal boosters ; retrait automatique à la fin du boost. Uniquement cosmétique (cahier : aucun avantage injuste).
- **V2** (**v2**) : bot gateway permanent (activité Discord PC/Xbox/PS, temps en vocal, « 3 membres jouent à X ») ; rangs importés via API officielles (Riot, Hypixel).
- **Plus tard** (**plus tard**) : VIP payant = cosmétique + confort (effets/thèmes exclusifs, plus de créations dans les limites Discord, stats détaillées, historique illimité) ; JAMAIS étages, XP, priorité, vote renforcé ni badges gagnés ; essentiel gratuit ; prérequis : statut, CGV/mentions légales, prestataire de paiement, TVA, rétractation, politique mineurs. Prévoir dans le modèle un champ d'entitlement sans aucun paiement implémenté.
- **Rappel 134 rôles Étage** (**v1**, prérequis du sujet F) : La création automatique de rôles (sujet F) exige d'abord la suppression des 134 rôles Étage (inventaire en lecture seule : `scripts/audit-tower-etage-roles.mjs`, `docs/TOWER_ROLE_REVIEW.md`). Aucune suppression n'est faite par le dépôt : elle reste une action manuelle du propriétaire.

Sujets de réalisation (v1) :

| Sujet | Branche prévue | Interrupteur | Migration |
| --- | --- | --- | --- |
| A. Équipes : recruteurs et invités | `claude/equipes-recruteurs-invites` | `TEAM_RECRUITERS_ENABLED` | `20261118130000_team_recruiters_guest` |
| B. Votes de preuves dans Discord | `claude/votes-discord-fils` | `TOWER_DISCORD_VOTES_ENABLED` | `20261118130100_tower_vote_messages` |
| C. Validation automatique Steam | `claude/validation-auto-steam` | `TOWER_STEAM_AUTOVALIDATE_ENABLED` | `20261118130200_tower_challenge_measure` |
| D. Soirées : visibilité et liste d'attente | `claude/soirees-visibilite` | `SESSION_VISIBILITY_ENABLED` | `20261118130300_session_visibility_waitlist` |
| E. Tournois par équipes | `claude/tournois-equipes` | `TOURNAMENT_TEAMS_ENABLED` | `20261118130400_tournament_teams` |
| F. /role : création automatique de rôles | `claude/role-creation-auto` | `DISCORD_ROLE_AUTOCREATE_ENABLED` | `20261118130500_discord_role_requests` |
| G. /projet : organisateur et clôture | `claude/projets-organisateur` | `PROJECT_ORGANIZER_ENABLED` | `20261118130600_project_entries` |
| H. Jouer maintenant et rivalités d'équipes | `claude/rivalites-equipes` | `TEAM_RIVALRIES_ENABLED` | `20261118130700_team_rivalries` |
| I. Notifications : MP ciblés et centre in-app | `claude/centre-notifications` | `NOTIFICATION_CENTER_ENABLED` | `20261118130800_notification_center` |
| J. Console : connexions de plateformes et crossplay | `claude/console-connexions-plateformes` | `DISCORD_CONNECTIONS_SCOPE_ENABLED` et `GAME_PLATFORMS_ENABLED` | `20261118130900_platform_identities_crossplay` |
| K. Niveau par jeu et matchmaking | `claude/niveau-jeu-matchmaking` | `GAME_LEVELS_MATCHMAKING_ENABLED` | aucune (si possible) |
| L. Modération : signalement contextuel | `claude/signalement-contextuel` | `DISCORD_REPORT_COMMAND_ENABLED` | `20261118131100_moderation_reports` |
| M. Boosters : Soutien de la Tour | `claude/boosters-nitro` | `DISCORD_BOOSTERS_ENABLED` | `20261118131200_booster_support` |
| N. Personnalisation du profil | `claude/profil-personnalisation` | `PROFILE_CUSTOMIZATION_ENABLED` | `20261118131300_profile_customization` |
| O. Tableau de bord staff v2 | `claude/admin-tableau-bord-v2` | `ADMIN_DASHBOARD_V2_ENABLED` | aucune |
