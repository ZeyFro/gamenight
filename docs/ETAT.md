# État de reprise — 6 novembre 2026

> **Remplacé le 17 novembre 2026 :** « Neon Test puis Production avec accords séparés » et « un flag par jour » ne sont plus la règle. Voir [MIGRATIONS.md](MIGRATIONS.md) (migrations appliquées automatiquement après fusion) et [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md) (Tour activée en une soirée). Les passages ci-dessous qui les décrivent sont historiques.

## Mise à jour du 20 novembre 2026 — état courant

- `main` = `6c0b25b` : les 33 PR du lot Tower 2.0 et du cahier v1.1 sont fusionnées, **aucune PR ouverte**. Chaque migration fusionnée pendant la chaîne des 19-20/11 a eu un run « Migrations Production » vert. Les paragraphes ci-dessous (6 novembre) sont **historiques**.
- Statut par sujet : [COUVERTURE_CAHIER.md](COUVERTURE_CAHIER.md) ; conditions de lancement : [CONDITIONS_REUSSITE_LANCEMENT.md](CONDITIONS_REUSSITE_LANCEMENT.md) (0 / 17 cochées) ; ordre d'activation : [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md) ; plan : [PLAN-J14-20261201.md](PLAN-J14-20261201.md) (ouverture la semaine du 1er décembre 2026).
- **Interrupteurs : 85 variables `*_ENABLED` dans le code, toutes présentes dans `.env.example`, toutes OFF par défaut** (actives seulement si la valeur vaut exactement `true`), à une exception près : `DISCORD_ROLE_SELF_CREATION_ENABLED` n'est coupé que par la valeur `false`. Il reste sans effet tant que `DISCORD_ROLE_COMMAND_ENABLED` (OFF) n'est pas activé : voir « Point d'attention » dans [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md). Aucun interrupteur n'est activé par le dépôt, aucun n'est vérifié en Production depuis ce dépôt.

Inventaire (ajouté le 20/11 : `ADMIN_DASHBOARD_V2_ENABLED`, `TEAM_RECRUITMENT_CRITERIA_ENABLED` et tous les interrupteurs v1.1 ne figuraient pas dans ce fichier) :

| Domaine | Variables |
| --- | --- |
| The Tower — les 4 interrupteurs du soir | `TOWER_CHALLENGES_ENABLED` · `TOWER_DISCORD_ANNOUNCE_ENABLED` · `TOWER_TEAM_DAILY_ENABLED` |
| The Tower — lot 2.0 et v1.1 | `TOWER_IRREGULAR_GRANTS_ENABLED` · `TOWER_CHALLENGE_REPLACEMENT_ENABLED` · `TOWER_CHALLENGE_PROPOSALS_ENABLED` · `TOWER_SEASON_AWARDS_ENABLED` · `TOWER_DISCORD_VOTES_ENABLED` · `TOWER_STEAM_AUTOVALIDATE_ENABLED` · `TOWER_ONBOARDING_PANEL_ENABLED` · `TOWER_DISCORD_PREFLIGHT_ENABLED` |
| Équipes, projets, profil | `TEAM_APPLICATIONS_ENABLED` · `TEAM_RECRUITERS_ENABLED` · `TEAM_RECRUITMENT_CRITERIA_ENABLED` · `TEAM_RIVALRIES_ENABLED` · `TEAM_CAPTAIN_HANDOVER_ENABLED` · `PROJECT_ORGANIZER_ENABLED` · `DISCORD_PROJECT_COMMAND_ENABLED` · `DISCORD_PROJECT_WRITE_ENABLED` · `DISCORD_TEAM_SPACES_ENABLED` · `PROFILE_VISIBILITY_ENABLED` · `PROFILE_CUSTOMIZATION_ENABLED` · `GAME_LEVELS_ENABLED` · `GAME_LEVELS_MATCHMAKING_ENABLED` · `GAME_PLATFORMS_ENABLED` |
| Soirées, tournois, roulette | `SESSION_VISIBILITY_ENABLED` · `TOURNAMENT_TEAMS_ENABLED` · `SESSION_CHRONICLES_ENABLED` · `SESSION_PREPARATION_ENABLED` · `SESSION_VIDEO_ENABLED` · `SESSION_SERIES_CANCEL_ENABLED` · `TOURNAMENT_PREDICTIONS_ENABLED` · `TOURNAMENT_SCORES_ENABLED` · `VOTE_VETO_ENABLED` · `ROULETTE_PLAYER_FILTER_ENABLED` · `WHO_PLAYS_TONIGHT_ENABLED` · `CALENDAR_SUBSCRIPTIONS_ENABLED` · `VOICE_PRESENCE_ENABLED` |
| Notifications, administration, Discord (rôles, signalement, boosters, connexions) | `NOTIFICATION_EXECUTOR_ENABLED` · `NOTIFICATION_CENTER_ENABLED` · `ADMIN_DASHBOARD_V2_ENABLED` · `DISCORD_ROLE_COMMAND_ENABLED` · `DISCORD_ROLE_SELF_CREATION_ENABLED` · `DISCORD_ROLE_AUTOCREATE_ENABLED` · `DISCORD_REPORT_COMMAND_ENABLED` · `DISCORD_BOOSTERS_ENABLED` · `DISCORD_CONNECTIONS_SCOPE_ENABLED` |
| Communauté et serveurs | `COMMUNITY_ISOLATION_ENABLED` · `COMMUNITY_PICKER_ENABLED` · `COMMUNITY_ADMIN_ENABLED` · `COMMUNITY_CHANNELS_ENABLED` · `COMMUNITY_AUTO_CREATE_ENABLED` · `COMMUNITY_SETUP_COMMAND_ENABLED` · `COMMUNITY_QUICK_POLLS_ENABLED` · `COMMUNITY_GAME_GRAVEYARD_ENABLED` · `COMMUNITY_EXPRESSIONS_ENABLED` · `COMMUNITY_HIGHLIGHTS_ENABLED` |
| Jeux et catalogue | `GAME_PREPARATION_TIME_ENABLED` · `FREE_GAME_FEED_ENABLED` · `STEAM_NOW_PLAYING_ENABLED` |
| Discord : annonces, MP, commandes | `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` · `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED` · `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED` · `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` · `DISCORD_DM_SESSION_ENABLED` · `DISCORD_DM_TOURNAMENT_ENABLED` · `DISCORD_DM_ROULETTE_ENABLED` · `DISCORD_THREAD_CLEANUP_ENABLED` · `DISCORD_THREAD_CLOSE_ON_END_ENABLED` · `DISCORD_SESSION_COMMAND_ENABLED` · `DISCORD_SESSION_WRITE_ENABLED` · `DISCORD_TOURNAMENT_COMMAND_ENABLED` · `DISCORD_TOURNAMENT_WRITE_ENABLED` · `DISCORD_PLAYER_COMMAND_ENABLED` · `DISCORD_PLAYER_WRITE_ENABLED` · `DISCORD_PROFILE_COMMAND_ENABLED` · `DISCORD_BOOSTER_ENABLED` |
| Site, sécurité, rétention, push | `GUIDE_V2_ENABLED` · `HOME_V2_ENABLED` · `PAGE_TITLES_ENABLED` · `PAGE_TITLES_DYNAMIC_ENABLED` · `SKIP_LINK_ENABLED` · `CSP_REPORT_ENABLED` · `RETENTION_CLEANUP_ENABLED` · `WEB_PUSH_ENABLED` |

Source de vérité : [issue #400](https://github.com/ZeyFro/gamenight/issues/400).
Les états CI sont des relevés ; relire les têtes et commentaires avant reprise.

## Dry-run Neon Test réellement réussi

#418 est fusionnée dans main, `b603dd03d398588f3a70086997f313af6e5dbbb1`.
[Run 42291255308](https://github.com/ZeyFro/gamenight/actions/runs/42291255308),
job migrate, tentative 1 : SUCCESS, après approbation standard de ZeyFro.
Le préflight Prisma natif et le runner ont vérifié le projet
`misty-tooth-45335023`, la branche `tower-migration-test-20261105`
(`br-snowy-snow-b1cggq2w`), la base `neondb`, l'endpoint direct et le rôle
`gamenight_test_migrator`, distinct du rôle applicatif, avec propriété/droits DDL.
TLS est requis par la configuration ; la version négociée n'est pas publiée.

Seulement deux migrations en attente, dans cet ordre :

1. `20261104140000_tower_team_membership_policy`, SHA-256
   `9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f`.
2. `20261105120000_tower_launch_channels_appeals_matchmaking`, SHA-256
   `e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de`.

Le journal confirme DRY-RUN, aucune écriture. La lecture indépendante Work après
le run confirme 118 entrées Prisma, aucune inachevée et aucune entrée pour ces
deux migrations. [Preuve complète et sauvegarde](https://github.com/ZeyFro/gamenight/issues/400#issuecomment-6696087598).
La sauvegarde `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`)
est ready, enfant de la cible, no_compute, point `0/2A355C30` ; limite 10 branches.
**La restauration reste à éprouver séparément.** Ne modifier/supprimer aucune
sauvegarde ni créer une branche pour contourner la limite.

Work a configuré environnement protégé main/ZeyFro, rôle et secret. Les refus
API Cloud pour approbation/listes de secrets ne prouvent pas leur absence.
Ne pas recréer ces ressources. Aucun secret à demander dans le chat.

## PR et dépendances

- #370 `6cff66b` : réouverture d'une équipe dissoute refusée, limite de créations
  couverte, index conservé sans réécriture SQL. 23 tests locaux ; CI verte.
- #406 `23ba5a8` : correctif roulette et B14, puis fixtures VAPID P-256 et
  restauration des environnements de test T4/T5. CI générale, rules/storage et
  Preview vertes. Compatibilité stricte avec #325 à simuler sur copie jetable.
- #396 `e582df3` : trois défauts corrigés, contre-tests conservés, 51 tests
  PostgreSQL revalidés et CI verte ; PR encore Draft.
- #407 `6ec348d` : arbitre fixe configuré à l'avance, journalisé et gelé pendant
  une contestation ouverte ; cas OWNER réservé à cet arbitre, délai 24 h après
  annonce effective. 114 tests ciblés et 3 707 en suite locale, CI verte.
  Migration `20261106150000_tower_fixed_arbiter` uniquement locale, hors du
  périmètre des deux migrations autorisées à préparer.
- #408 `0e9ff59` et #416 `3f2702f` : parents intégrés, respectivement 60 et 81 tests
  ciblés, CI vertes. #416 reste empilée sur #408 ; aucun enregistrement Discord.
- #415 (préflight local), #417 (podium en lecture seule) et #413 (documentation)
  sont des lots autonomes sans migration : intégrer main, vérifier le périmètre,
  tests/typage/lint/CI et revue indépendante avant Ready. Le propriétaire a
  autorisé ce Ready ciblé ; aucune fusion automatique. SHA et résultats dans #400.
- #395 et #414 fermées sans fusion ; exclusion des comptes de test retirée,
  aucune API OpenAI payante ni activation de pilote payant.

## Ordre obligatoire et prochaine reprise

1. Préparer dans une PR Draft un workflow manuel distinct d'application de #370
   puis #406 sur Neon Test. Le runner applique tous les dossiers présents :
   stage118+370 seul, contrôle après119, ajout406 seulement ensuite et contrôle120.
   Vérifier checksums, schéma, données, rôle et TLS avant/après chaque étape.
   Aucun apply tant que revue, restauration, contrôles et accord distinct manquent.
2. #370 et #406 ne sont pas fusionnées ; aucune migration de ces PR appliquée
   à Neon Test ou Production au dernier relevé. Production option B : préparation
   seulement après validation Neon Test, autorisation Production séparée.
3. #325 appartient exclusivement à Claude Code. Le jalon officiel exige
   **#370 ET #406 fusionnées sur main ET leurs migrations appliquées en Production**.
   Alors seulement annoncer : « #370 et #406 mergées et migrées, #325 peut passer
   en phase 4 ». Après ce jalon, ne fusionner aucune autre PR contenant une
   migration tant que #325 n'a pas été migrée. Claude seul attribuera ses nouveaux
   horodatages réels ; ne pas contourner le garde chronologique ni modifier #325.
4. Recette/OAuth, Discord/Atlas/rôles/bots, catalogue/flags/activation/bêta :
   configuration autorisée, intégrations et preuves de vrais membres encore
   nécessaires. Tests locaux/Preview ne valent pas recette réelle ni ouverture.

Les répétitions SQL antérieures étaient sur PostgreSQL fictif local :118→119→120,
puis121 pour #407. Elles ne sont pas des migrations distantes. Aucun merge,
Ready hors du lot autorisé, migration distante, variable Vercel, flag ou action
Discord effectué par cette préparation. Quota réel non mesurable : cible10 %
non garantie ; poursuivre utilement sans boucle ni relance inutile.

#410 a été fusionnée historiquement dans une ancienne branche documentaire,
mais son UI n'est pas dans main. Son historique est préservé et aucun fichier UI
n'est importé par #413 ; réintégration séparée à prévoir selon plafond de PR.
