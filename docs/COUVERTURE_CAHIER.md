# Couverture du cahier des charges The Tower 2.0 (17/11/2026)

Méthode : chaque section de `docs/CAHIER_DES_CHARGES.md` et chaque décision de `docs/DECISIONS_TOWER.md` comparées à `main` (23f58a8d) et aux branches des PR ouvertes #370, #406, #407, #408, #416, #444, #325 (lues, jamais modifiées). Au moment de l'analyse aucune de ces PR n'était fusionnée ; #370 l'a été ensuite (be688d18) : les lignes « PR #370 » ci-dessous sont désormais sur main.

Statuts : **Livré** (sur main, actif) · **Livré désactivé** (sur main ou dans une PR, derrière un flag OFF ou une migration non appliquée) · **Partiel** · **Manquant**. « PR » = présent seulement dans la branche d'une PR ouverte (donc pas sur main).

Numérotation : le brief de tâche renvoie à des §6-7, §8.2-8.3, §9, §10 qui ne correspondent pas à ce cahier. Correspondance retenue : recherche de joueurs = §12, candidatures d'équipe = §11.1, projets = §11.3 (forum « Projets et aventures »), visibilité du profil = §12.3-12.4.

## Écarts code actuel / décisions (à trancher ou corriger)

| Règle décidée | Code actuel | Fichier |
| --- | --- | --- |
| High Ranker : ≥ 100 étages + ≥ 5 défis validés sur la saison en cours | ≥ 100 étages + au moins une saison terminée | `src/lib/tower-ranks.ts` (corrigé par la PR « grades ») |
| Couleurs : Régulars gris, Irregular violet, Ranker or, High Ranker rouge | Irregular bleu, Ranker violet, High Ranker or | `src/lib/tower-ranks.ts`, `src/components/TowerRankBadge.tsx` (corrigé par la PR « grades ») |
| Irregular = attribution manuelle staff ; Régulars dès l'inscription | Irregular est le rang par défaut calculé (< 30 étages) | `src/lib/tower-ranks.ts` (corrigé par la PR « grades ») |
| S1 du 01/12/2026 au 31/03/2027, puis avril–juin, été juillet–août, septembre–novembre | S4 sept.–déc., intersaison 1–3 janvier, S1 4 janvier–28 mars, intersaison 29–31 mars | `src/lib/tower-challenge-seasons.ts`, `docs/TOWER_DECISIONS_26_20261104.md` |
| Défi d'équipe attribué à 18:00 Europe/Paris | 09:00 (workflow + cron) | PR #407 : `.github/workflows/tower-team-daily.yml`, `docs/TOWER_TEAM_DAILY_CRON.md` |
| Sans quorum à 24 h : prolongation unique de 24 h puis rejet sans pénalité, une resoumission | Preuve en attente sans re-vote ; signalement staff à 7 j, archivage à 30 j | main `src/lib/tower-challenge-voting.ts` (reste OPEN) ; PR #407/#408 `tower-challenge-aging-rules.ts` |
| Contestation ouverte 48 h après la décision | 24 h | PR #407/#408 `tower-challenge-appeal-rules.ts` (`TOWER_CHALLENGE_APPEAL_WINDOW_MS`) |
| Équipes 2 à 8 | Aligné depuis la fusion de #370 (`community-teams-rules.ts`) | résolu |
| Récompenses cosmétiques uniquement | Le top 1 peut proposer un défi pour la saison suivante (décision du 04/11) | `src/lib/tower-season-proposal.ts` : à confirmer par le propriétaire |

## Par section du cahier

| § | Exigence | Statut | Fichiers / remarques |
| --- | --- | --- | --- |
| 3 | Organisation du serveur (gabarit, permissions) | Livré désactivé | `src/lib/tower-discord-layout.json`, `scripts/provision-tower-layout.mjs` (dry-run), `docs/TOWER_COMMANDES_GUILD.md` ; aucune écriture Discord réelle autorisée |
| 4 | Onboarding Discord d'abord, panneau 3 boutons | Livré désactivé | `src/lib/tower-onboarding-panel.ts`, `src/lib/tower-onboarding-actions.ts` (`TOWER_ONBOARDING_PANEL_ENABLED`), `docs/TOWER_ONBOARDING_PANEL_SETUP.md` ; publication par workflow dédié |
| 5 | Identité visuelle | Partiel | thème existant ; harmonisation Discord hors dépôt |
| 6.1 | Grades Régulars / Irregular / Ranker / High Ranker | PR #456 | `tower-ranks.ts` aligné (30 / 100 + 5 défis, gris/violet/or/rouge) ; stockage de l'Irregular manuel : **Manquant** (migration) |
| 6.2 | Aucun droit de modération par grade | Livré | rangs purement cosmétiques (`tower-ranks.ts`) ; les droits viennent de `Membership.role` |
| 6.3 | Remplacement des 134 rôles Etage | Livré désactivé | inventaire en lecture seule `scripts/audit-tower-etage-roles.mjs`, `docs/TOWER_ROLE_REVIEW.md` ; aucune suppression (interdite) |
| 7.1-7.4 | Ascension infinie, étages permanents, barème 1/2/3 | Livré désactivé | `src/lib/tower-progression.ts`, `tower-personal-progress.ts`, page `/ascension` (`TOWER_CHALLENGES_ENABLED` + drapeau communautaire) |
| 7.2 | Pas de double source avec Atlas | Partiel | procédure `docs/TOWER_ATLAS_ARRET.md` ; arrêt effectif côté Discord à faire par le propriétaire |
| 8.2 | Défi solo : 1 attribution / 12 h, 48 h pour réaliser | Livré désactivé | `src/lib/tower-challenge-rules.ts` (`canClaimSoloChallenge`, `challengeProofDeadline`), `tower-challenges.ts` |
| 8.3 | Défi d'équipe quotidien | Livré désactivé / écart | `tower-team-daily.ts` sur main ; route cron + workflow 09:00 dans PR #407 (décision : 18:00) |
| 8.4 | Max 2 réussites validées par jour | Livré désactivé | `canReceiveChallengeReward`, `remainingChallengeRewardsToday` |
| 8.5-8.6 | Variété, remplacement si jeu non possédé | Partiel | catalogues `tower-challenge-starter-catalogue.ts`, `tower-team-challenge-starter-catalogue.ts`, `docs/TOWER_SAISON1_CATALOGUE_30.md` ; remplacement de défi : **Manquant** |
| 8.7 | Proposition de défis par grades élevés | Manquant | seule la proposition du top 1 existe (`tower-season-proposal.ts`) |
| 9.1 | Dépôt de preuve, consentement de publication | Livré désactivé | `tower-challenges.ts` (`publicationConsent`) ; code de preuve : PR #407/#408 |
| 9.2 | Vote 24 h, 3 votants, majorité, pas d'auto-vote, égalité = non validé | Livré désactivé | `tower-challenge-voting.ts` ; sans quorum : écart (voir plus haut) |
| 9.3 | Contestations, arbitre fixe, 1 par défi | PR | PR #407 (arbitre fixe, `TowerChallengeAppeal`) ; fenêtre 24 h au lieu de 48 h |
| 9.4 | Aucune IA de validation | Livré | aucun appel IA dans le code |
| 10 | Annonces de réussites (consentement) | Livré désactivé | `tower-challenge-announcements.ts` (`TOWER_DISCORD_ANNOUNCE_ENABLED`) |
| 10.3 | Récapitulatifs hebdomadaires, mise en avant | Partiel | `/recap`, `/classement` ; pas de récap Tower dédié |
| 11.1 | Découvrir, créer, rejoindre une équipe | Livré | `/equipes`, `src/lib/community-teams.ts` |
| 11.1 | Présenter sa candidature, recruter | PR #457 (Livré désactivé après fusion) | `team-applications.ts`, `/equipes/candidatures`, `TEAM_APPLICATIONS_ENABLED`, migration `20261118103000_team_applications` (après #416) |
| 11.2 | Nom, présentation, capitaine, membres, jeux, critères de recrutement | Partiel | `CommunityTeam` (nom, description, plateforme, jeu, `isRecruiting`) ; capitaine PR #370/#406/#444 ; objectifs/critères structurés : Manquant |
| 11.3 | Forums, tags | Livré désactivé | `src/lib/tower-forums.ts`, `/tower/forums`, `docs/TOWER_FORUM_TAGS.md` |
| 11.3 | « Projets et aventures » | Partiel | « Lancer une aventure » sur `/equipes` (équipe persistante avec objectif) ; pas de modèle de projet distinct, volontairement non dupliqué |
| 11.4 | Équipes décidées : 2–8, équipe unique, délai 7 j, capitaine | Livré (#370 fusionnée) | `community-teams.ts`, `community-team-handover.ts`, migration `20261104140000_tower_team_membership_policy` |
| 12.2-12.3 | Chercher un joueur par jeu | Livré désactivé | `/joueurs`, `src/lib/player-classifieds.ts` (`playerClassifiedsEnabled`) |
| 12.2 | Filtres plateforme, disponibilité, mode (détente/compétitif), micro | PR | PR #408 : `player-classified-filters.ts`, migration `20261105120000_tower_launch_channels_appeals_matchmaking` |
| 12.2 | Filtre niveau de jeu | Manquant | ni champ ni filtre, y compris dans #408 : à faire après #408 (migration) |
| 12.3 | « Qui joue ce soir ? » | Livré désactivé | `/ce-soir` (`WHO_PLAYS_TONIGHT_ENABLED`) |
| 12.3 | Respect de la visibilité du profil | PR #459 (Livré désactivé après fusion) | `profile-visibility.ts`, `canViewPote`, `PROFILE_VISIBILITY_ENABLED`, migration `20261118103100_profile_visibility` (après #416) ; ne couvre pas classements ni soirées |
| 12.4 | Profil : jeux favoris, plateformes, niveaux, disponibilités | Partiel | plateformes/micro (`User.availablePlatforms`), tier list, préférences ; niveaux par jeu : Manquant |
| 13 | Soirées, calendrier, tournois, roulette | Livré | `/sessions`, `/calendrier`, `/tournois`, `/roulette` |
| 14.1-14.2 | Calendrier des saisons | Partiel | `tower-challenge-seasons.ts` aligné sur la décision du 04/11, pas celle du 17/11 (voir écarts) |
| 14.3 | Classements individuel, saisonnier, permanent (départage déjà conforme à la décision) | Livré désactivé | `tower-standings.ts` (départage étages, défis difficiles, date d'atteinte), `towerSeasonTotals` ; palmarès `/tower/palmares` |
| 14.3 | Classement d'équipes | Partiel | `/classement` ; pas de classement d'équipes Tower |
| 14.4 | Réinitialisation saisonnière, étages conservés | Livré désactivé | totaux calculés par fenêtre de saison (`tower-season-rules.ts`) |
| 15 | Récompenses cosmétiques, Hall of Fame | Partiel | `tower-season-podium.ts`, `docs/TOWER_S1_REWARDS_MANUAL.md` (remise manuelle) ; cadres/titres automatisés : Manquant |
| 16 | Le Sommet | Livré désactivé | `/tower/palmares` |
| 17 | Salons vocaux temporaires | Hors périmètre v1 | décision du 17/11 |
| 18 | Bots historiques (YAGPDB, Atlas, Ticket Tool, Appy) | Partiel | audits `docs/TOWER_TICKET_TOOL_AUDIT.md`, `TOWER_ATLAS_ARRET.md`, `AUDIT_DISCORD.md` ; actions Discord réelles réservées au propriétaire |
| 19 | Sécurité, isolation communautaire | Livré | `scopedDb`, gardes `community-isolation.ts`, `docs/SECURITE_CLAUDE.md` |
| 20 | IA / Activities | Hors périmètre v1 | décision du 17/11 |
| 21-22 | Idempotence, tests critiques | Livré désactivé | `docs/TOWER_IDEMPOTENCE_AUDIT.md`, tests `tower-*.test.ts` et intégration |
| 23-25 | Phases, lancement, conditions de livraison | Partiel | `docs/TOWER_PHASE1_RECETTE_PUBLIQUE.md`, `TOWER_KIT_BETA_T19.md`, `PLAN-J14-20261201.md` ; vérifications réelles Discord à faire |

## PR ouvertes de ce lot

- #450 : `docs/DECISIONS_TOWER.md`.
- #452 : ce document.
- #456 : grades et couleurs (sans migration).
- #457 : candidatures d'équipe (migration, après #416).
- #459 : visibilité du profil (migration, après #416).

## Manques restants (non traités dans ce lot)

- Filtre « niveau de jeu » pour la recherche de joueurs : exige une migration et touche les mêmes fichiers que #408 ; à faire après #408.
- Calendrier de saisons du 17/11 (S1 du 01/12/2026 au 31/03/2027, avril–juin, été, septembre–novembre) : non traité, car il réécrit `tower-challenge-seasons.ts` et une dizaine de tests (dont l'intégration) et la répétition annuelle du cycle décembre–mars n'est pas explicitée ; **bloquant pour la semaine du 1er décembre** (le code actuel place le 1er décembre dans « S4 », S1 démarrant le 4 janvier).
- Stockage de l'attribution manuelle d'Irregular (migration).
- Recherche de joueurs : le filtre « niveau » et la reprise des écarts de #408 (hors périmètre pour éviter des conflits sur les mêmes fichiers).
- Remplacement d'un défi quand le jeu n'est pas possédé (§8.6), proposition de défis par grade (§8.7).
- Écarts qui vivent dans les PR #407/#408 (18:00, quorum, contestation 48 h) : à corriger dans leurs branches, non touchées ici.
- Classement d'équipes Tower, cadres/titres cosmétiques automatisés, récapitulatif hebdomadaire Tower.
