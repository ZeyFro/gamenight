# Point de reprise unique — GameNight — 22 octobre 2026

Seul point de reprise à jour. Il remplace les reprises datées et les bilans antérieurs, qui sont historiques. Continuer dans un worktree dédié : le checkout racine est ancien et contient des modifications locales.

État vérifié contre `origin/main` = `e67fd8f` (après #317, #318, #320, #321 et #322). GitHub déclare le déploiement Production de `e67fd8f` en `success` (22 octobre, 18:54 UTC); l'association actuelle des alias n'a pas été revérifiée depuis `26440e1`, dont le déploiement est détaillé plus bas.

## Production

- Déploiement Vercel `dpl_EiRGtcdKENELiYuGvV261NPs4GHa` : `READY`, cible `production`, SHA `26440e1`, alias GameNight associés, `aliasError=null` (connecteur Vercel, 22 octobre). Il remplace l’échec du déploiement automatique de `244eee3` (deployment GitHub `7232777326`), dont la cause n’a jamais été établie.
- Ce que cela prouve : l’association domaine ↔ déploiement à cet instant. Cela ne prouve ni le binding `DATABASE_URL` → Neon ni les configurations runtime.
- `DATABASE_URL` : variable `sensitive`, cible `production` seule, valeur illisible, modifiée avant le build de ce déploiement, absente de Preview. Binding non prouvé formellement.
- Neon (lecture seule, `SELECT` sur `_prisma_migrations`, branche `production`) : dernière migration appliquée `20261020110000_tournament_team_bracket`, aucune annulée parmi les 15 plus récentes. C’est la dernière migration de `main` : Production est alignée sur `main`.
- Les journaux runtime Vercel restent en 403.

## Drapeaux Production (noms seulement)

Les valeurs sont `sensitive` donc illisibles : un nom présent ne dit pas ON ou OFF. Seule la présence est établie.

- Présents : `NOTIFICATION_EXECUTOR_ENABLED`, `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, `DISCORD_DM_SESSION_ENABLED`, `DISCORD_DM_TOURNAMENT_ENABLED`, `DISCORD_DM_ROULETTE_ENABLED`, `DISCORD_THREAD_CLEANUP_ENABLED`, `DISCORD_THREAD_CLEANUP_MODE`, `DISCORD_THREAD_CLOSE_ON_END_ENABLED`, `STEAM_NOW_PLAYING_ENABLED`, `COMMUNITY_AUTO_CREATE_ENABLED`, `COMMUNITY_SETUP_COMMAND_ENABLED`, `COMMUNITY_CHANNELS_ENABLED`, `COMMUNITY_ISOLATION_ENABLED`, `COMMUNITY_PICKER_ENABLED`, `AUTH_REQUIRE_GUILD_MEMBER`.
- Absents, donc éteints (défaut OFF) : `COMMUNITY_ADMIN_ENABLED`, `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`, `RETENTION_CLEANUP_ENABLED`/`_MODE`, `PAGE_TITLES_ENABLED`, `GUIDE_V2_ENABLED`, `TOURNAMENT_SCORES_ENABLED`, `VOTE_VETO_ENABLED`, `ROULETTE_PLAYER_FILTER_ENABLED`.
- Les identifiants de salons et de serveur du bot sont des variables `config` chiffrées. Aucune clé VAPID n’est déclarée.

## PR ouvertes

| PR | Tête | Contrôles | Condition restante |
|---|---|---|---|
| [#291 XP](https://github.com/ZeyFro/gamenight/pull/291) | `d45ea94` | `verify` et Vercel verts, mergeable | Draft. Ajoute la migration `20261022142500_shop_balance_purchase_reason`, non appliquée en Production. Aucune autorisation de migration. |
| [#303 Vocal](https://github.com/ZeyFro/gamenight/pull/303) | `1ac6e8c` | à revérifier sur ce SHA | Draft. Contient une migration vocale : la fusionner l'appliquerait au build de production, donc pas de fusion sans autorisation. Les décisions de consentement sont arrêtées et implémentées (commentaire #303 du 22 octobre à 11:01) : opt-in individuel, durées visibles par la personne, le créateur et les admins autorisés, rétention de 30 jours, suppression au retrait et à l'annulation. |
| [#319 XP, bascule](https://github.com/ZeyFro/gamenight/pull/319) | `dd5f2f0` | pas de `verify` (base = branche de #291) | Draft, rattachée à #291. |

#315 et #316 sont fusionnées. Les décisions déjà acquises restent valables : aucune migration, interruption de writers, restauration Neon, activation de drapeau ou cron, collecte vocale réelle ni notification Discord réelle sans accord écrit pour l’action précise.

## Recette navigateur : exécutions distinctes

- 29/29 : dernier run complet rapporté, sur `1dce077`.
- 20/22 plus reprises ciblées : exécution distincte, sur un autre SHA. Ne pas additionner ni confondre les deux.
- Un run local plus ancien (`e27741a`) a été interrompu à l’étape 7 : ce n’est pas un succès.
- « Code présent » n’est jamais « validé en service » : une recette locale ou sur mock ne valide pas la Production.

## Reprise

1. XP : demander l’autorisation de la fenêtre (sauvegarde fraîche restaurée sur cible isolée, application de la migration `20261022142500`, plan de repli). Le script de bascule, le plan de maintenance et la vérification de restauration Docker sont en préparation, sans exécution en Production ; leur état sera porté par la PR correspondante.
2. Vocal : les décisions produit sont arrêtées (voir #303). Restent trois opérations distinctes à autoriser : la migration vocale en Production, l'installation du worker et l'activation de la collecte.
3. Hors périmètre, à faire approuver avant construction : paiement intégré, catégories MVP personnalisables par communauté, hors-ligne complet.
