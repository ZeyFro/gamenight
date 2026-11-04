# Reprise actuelle — The Tower 2.0 × GameNight (4 novembre 2026)

> **État du relevé GitHub, non certificat de livraison.** Les sections datées du 2 et du 3 novembre ci-dessous sont historiques et ne doivent pas être utilisées comme état courant.

- `main` : `c422967` lors du relevé. **#362 est fusionnée** ; la recherche et le dédoublonnage de la liste des jeux sont développés, mais la recette multi-comptes reste à valider.
- **#366** (classification d'erreurs Auth.js), **#363** (script d'enregistrement guild-only) et **#368** (décisions §26, à vérifier selon son état GitHub lors de la reprise) : distinguer fusion et activation réelle.
- **PR de travail non fusionnées** : #325 (XP/vocal, fenêtre de maintenance obligatoire), #367 (catalogue 30 défis, non importé), #369 (sécurité Preview), #370 (équipes, migration non appliquée), et #371 à #391 (lots distincts en brouillon au relevé). Les tests CI de chaque HEAD et les revues de Claude sont nécessaires ; la simple existence d'une PR ne vaut pas fonctionnalité livrée.
- **Base de recette** : `preview-gamenight` contient un schéma obsolète ; les données User/Community/Membership étaient vides au relevé. Aucune Preview authentifiée ne doit écrire avant migration du schéma et confirmation du raccordement Neon et du blocage des crons et envois Discord.
- **Discord** : /tower et /tower-admin non confirmées enregistrées ; aucune action de rôles, de publication ni de suppression autorisée sans accord. Vérifier Atlas, Ticket Tool et les permissions sur le vrai serveur.
- **Décisions** : barème +1/+2/+3 ; Ranker 30, High Ranker 100 + saison terminée ; équipe 2 à 8, une équipe par joueur et délai 7 jours ; activité capitaine 30 jours ; S1 du 4 janvier au 28 mars 2027 (heure de Paris) ; exclusion des comptes de test des votes de production. Voir `docs/TOWER_DECISIONS_26_20261104.md` sur la branche où la décision a été proposée ; confirmer sa présence sur `main` avant utilisation.
- **Lancement** : bêta interne mi-décembre ; 4 janvier 2027 cible conditionnelle ; 1er février 2027 repli. Pas d'IA ni Activities au lancement.
- **Toujours interdit sans accord explicite** : merge, flag, variable Vercel, migration prod, import, enregistrement des commandes, suppression de rôles/salons/messages.

---

## Archives de reprise 2–3 novembre 2026

Ce document décrit les constats du 2 novembre 2026, complétés le 3 novembre (section ci-dessous). Les anciens bilans sont historiques. Préserver les changements locaux et travailler sur une branche dédiée ; aucun push direct sur `main`.

## État au 3 novembre 2026

Légende : **vérifié** = constaté dans le dépôt, GitHub ou les logs Vercel ; **rapporté** = déclaré par le propriétaire, non revérifié ici.

- `main` à `8a1cdf37fd841cf75f52437d030a5b9fa67155d0` (#355), vérifié. Fusionnées le 3 novembre : #351, #352 (jeton OAuth révoqué effacé au lieu d'être réessayé), #353 (docs : le build ne migre plus), #354 et #355 (budget de temps de 45 s des crons `close-sessions` et `discord-thread-cleanup`).
- PR ouvertes : seulement [#325](https://github.com/ZeyFro/gamenight/pull/325) (Draft, ne jamais fusionner hors fenêtre de maintenance). [#347](https://github.com/ZeyFro/gamenight/pull/347) est fermée sans fusion (audit dépassé par #348 à #355). Vérifié.
- Neon : snapshot de Production créé et sept migrations Tower marquées appliquées (étapes 1 et 2 de la phase 3 ci-dessous), rapporté. Tables Tower vides. Aucun flag Tower actif : la Tour est éteinte. Rapporté.
- Index `TowerChallengeAttemptParticipant(attemptId, communityId)` : absent du schéma et des migrations depuis #348, cohérent avec la base ; la clé primaire `(attemptId, userId)` couvre les requêtes. Vérifié dans le dépôt.
- Vercel : `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID` et `TOWER_DISCORD_GENERAL_CHANNEL_ID` créées, rapporté.
- Discord : `/tower` et `/tower-admin` **ne sont pas enregistrées** sur le serveur The Tower. La tentative d'enregistrement (deux POST de commandes de serveur avec le jeton du bot) s'est arrêtée sur HTTP 403 ; elle n'a pas été réessayée et est abandonnée pour l'instant (rapporté). Cause probable, non confirmée : application non autorisée sur ce serveur avec le scope `applications.commands` (code Discord 50001 attendu) ou jeton d'une autre application. Pour reprendre : réinviter l'application (`scope=bot applications.commands`, permissions minimales de `src/lib/discord-setup-permissions.ts`, `guild_id` du serveur), relancer l'enregistrement et lire le champ `code` de la réponse en cas d'échec.
- Cron `refresh-discord-profiles` (logs Production du 3 novembre, 20:00 UTC, vérifié) : 0 échec, 0 révoqué, mais les 7 jetons OAuth stockés sont illisibles (déchiffrement impossible) et passent par le repli bot. Cause probable : clé de chiffrement différente de celle des jetons stockés, à confirmer en lecture seule. Les jetons sont réécrits à la prochaine connexion de chaque utilisateur.

Prochaines étapes, chacune sur accord explicite du propriétaire : faire entrer de vrais joueurs et vérifier une annonce de soirée réelle ; puis, sur « go flags » et un par jour : `towerChallengesEnabled` (communauté), `TOWER_CHALLENGES_ENABLED`, import du catalogue par `/tower-admin` (exige d'abord l'enregistrement des commandes ci-dessus), `TOWER_DISCORD_ANNOUNCE_ENABLED`.

## État publié vérifié (relevé du 2 novembre)

- Référence actuelle : `main` à `dc060f57dd3aea156ab49471ef8ada25fe6a018d` (fusion de #348, index Prisma Tower aligné sur la base). Relevé initial du 2 novembre fait à `a8242eea0d5853964bf495b53d6d30eeb0eb2371` (#342). `prisma/migrations` contient **118** dossiers de migration à ce SHA : 111 relevées appliquées dans Neon + les 7 migrations Tower ci-dessous.
- Vercel : déploiement `dpl_332EeJH56oxQpaccf2mV8VVJga2H`, cible Production, `READY` au SHA `a8242ee` (relevé initial, non revérifié depuis). Les alias GameNight étaient associés, `aliasError=null`. Cela ne prouve pas le binding de la connexion SQL du runtime, ni l'état des flags.
- PR ouvertes à `dc060f5` : [#325](https://github.com/ZeyFro/gamenight/pull/325), Draft, tête `ea78a86e194f6e834b133ec772b8d8809ebe8801`, GitHub `mergeable=false` (relevé initial ; les preuves historiques de CI décrites dans la PR ne certifient pas son intégration au `main` actuel), et [#347](https://github.com/ZeyFro/gamenight/pull/347), Draft, audit documentaire du 2 novembre.
- Le build de `main` ne lance plus de migration implicitement (voir `CLAUDE.md` et `scripts/build.mjs`). Ne pas réintroduire cette dépendance.
- `src/lib/discord-tower-challenges.ts` journalise déjà les échecs de traitement et de livraison privée : le `catch` de traitement n'est pas vide.

## Neon — lecture seule

Projet `misty-tooth-45335023`, branche primaire/par défaut `production` (`br-super-cell-b1ukvk08`), base `neondb`.

Au 3 novembre, ces sept migrations sont marquées appliquées (rapporté, voir plus haut). Relevé du 2 novembre : `_prisma_migrations` a retourné 111 migrations terminées, aucune annulée ; dernière : `20261020110000_tournament_team_bracket`. Les sept migrations Tower présentes dans `main` ci-dessous n'ont aucune entrée dans ce relevé :

1. `20261026180000_community_teams`
2. `20261026190000_session_community_team`
3. `20261026210000_tower_levels_per_floor`
4. `20261026220000_community_team_game_restrict`
5. `20261028140000_tower_challenges`
6. `20261028230000_tower_season_vote`
7. `20261029061000_tower_team_challenges`

Le fichier annoncé `claude/migrations-a-marquer.md` n'est pas publié dans `main` ni dans l'historique Git disponible. La liste ci-dessus vient de la comparaison du dépôt au relevé SQL. **Une entrée manquante ne prouve pas que le SQL est déjà appliqué** : contrôler schéma, contraintes, index et données de remplissage avant tout marquage. La quatrième migration remplace notamment une contrainte de suppression en cascade par `RESTRICT`.

Branches Neon au relevé du 2 novembre 2026 (lecture seule, liste du projet) : les deux branches Preview Tower `preview-tower-20261030` et `preview-tower-v2-20261030` **n'existent plus** (supprimées). Branche à conserver, toujours présente :

| Branche | Identifiant | État au relevé |
|---|---|---|
| `backup-avant-tower-migrations-20261030` | `br-old-hat-b11o5wof` | ready — à conserver |

Un second appel SQL ciblé a échoué avec HTTP 401 après le premier relevé réussi ; aucune écriture tentée.

## Blocages d'accès et périmètre local

- L'exécution de cette reprise est hébergée : le journal Windows `C:\Dev\MEMOIRE_COMMUNE` n'est pas accessible ici. Aucun commit de son contenu local ne doit être inventé.
- Le navigateur Discord disponible arrive sur la connexion. L'accès du rôle Blacklist au salon `#qui-joue-ce-soir` n'a pas été vérifié ; aucune permission ni publication modifiée.
- Les valeurs des flags et les intégrations réelles ne sont pas certifiées par les métadonnées de déploiement. Ne pas considérer les listes de flags du 22 octobre comme actuelles.

## Phase 3 — accord écrit séparé avant chaque action

Ne rien exécuter dans cette section sans un « OUI » du propriétaire pour l'action précise, dans cet ordre :

1. ~~Créer un snapshot de la branche Production~~ — fait (rapporté, 3 novembre). Le snapshot n'a jamais été restauré.
2. ~~Marquer les sept migrations Tower~~ — fait (rapporté, 3 novembre). Rappel de la règle suivie : après preuve que les effets SQL existent déjà et validation des checksums, marquer les sept migrations Tower une par une ; vérifier chaque inscription. Ne pas confondre ce marquage et l'application du SQL.
3. ~~Supprimer uniquement les deux branches Preview Tower~~ — fait, vérifié le 2 novembre 2026 : les deux branches sont absentes de la liste Neon. Ne jamais supprimer `backup-avant-tower-migrations-20261030`.
4. #325 : pas de fusion sans confirmation explicite de la fenêtre de maintenance et réalisation des étapes 1 et 2. Rappeler les six préconditions de la description de PR : binding Vercel→Neon ; rôles runtime/migration distincts ; barrière et drainage des writers ; sauvegarde fraîche restaurée en isolation ; durée/impact des migrations ; processus de migration explicite avant déploiement. Le snapshot seul ne remplace pas la restauration vérifiée. Les six migrations XP/vocal de #325 sont distinctes des sept migrations Tower ci-dessus.
5. Activer un flag seulement à la demande du propriétaire, un à la fois. Migration vocale, installation du worker et collecte réelle restent distinctes.

Le propriétaire gère la connexion Codex, les invitations, les permissions/rôles Discord et les publications Discord. Aucun secret ne doit figurer dans un fichier, une PR ou un compte rendu.
