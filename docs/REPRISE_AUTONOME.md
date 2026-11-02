# Point de reprise unique — GameNight — 2 novembre 2026

Ce document décrit les constats vérifiés le 2 novembre 2026. Les anciens bilans sont historiques. Préserver les changements locaux et travailler sur une branche dédiée ; aucun push direct sur `main`.

## État publié vérifié

- Référence actuelle : `main` à `dc060f57dd3aea156ab49471ef8ada25fe6a018d` (fusion de #348, index Prisma Tower aligné sur la base). Relevé initial du 2 novembre fait à `a8242eea0d5853964bf495b53d6d30eeb0eb2371` (#342). `prisma/migrations` contient **118** dossiers de migration à ce SHA : 111 relevées appliquées dans Neon + les 7 migrations Tower ci-dessous.
- Vercel : déploiement `dpl_332EeJH56oxQpaccf2mV8VVJga2H`, cible Production, `READY` au SHA `a8242ee` (relevé initial, non revérifié depuis). Les alias GameNight étaient associés, `aliasError=null`. Cela ne prouve pas le binding de la connexion SQL du runtime, ni l'état des flags.
- PR ouvertes à `dc060f5` : [#325](https://github.com/ZeyFro/gamenight/pull/325), Draft, tête `ea78a86e194f6e834b133ec772b8d8809ebe8801`, GitHub `mergeable=false` (relevé initial ; les preuves historiques de CI décrites dans la PR ne certifient pas son intégration au `main` actuel), et [#347](https://github.com/ZeyFro/gamenight/pull/347), Draft, audit documentaire du 2 novembre.
- Le build de `main` ne lance plus de migration implicitement (voir `CLAUDE.md` et `scripts/build.mjs`). Ne pas réintroduire cette dépendance.
- `src/lib/discord-tower-challenges.ts` journalise déjà les échecs de traitement et de livraison privée : le `catch` de traitement n'est pas vide.

## Neon — lecture seule

Projet `misty-tooth-45335023`, branche primaire/par défaut `production` (`br-super-cell-b1ukvk08`), base `neondb`.

Le relevé de `_prisma_migrations` a retourné 111 migrations terminées, aucune annulée ; dernière : `20261020110000_tournament_team_bracket`. Les sept migrations Tower présentes dans `main` ci-dessous n'ont aucune entrée dans ce relevé :

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

1. Créer un snapshot de la branche Production et vérifier sa création avant la suite.
2. Après preuve que les effets SQL existent déjà et validation des checksums, marquer les sept migrations Tower une par une ; vérifier chaque inscription. Ne pas confondre ce marquage et l'application du SQL.
3. ~~Supprimer uniquement les deux branches Preview Tower~~ — fait, vérifié le 2 novembre 2026 : les deux branches sont absentes de la liste Neon. Ne jamais supprimer `backup-avant-tower-migrations-20261030`.
4. #325 : pas de fusion sans confirmation explicite de la fenêtre de maintenance et réalisation des étapes 1 et 2. Rappeler les six préconditions de la description de PR : binding Vercel→Neon ; rôles runtime/migration distincts ; barrière et drainage des writers ; sauvegarde fraîche restaurée en isolation ; durée/impact des migrations ; processus de migration explicite avant déploiement. Le snapshot seul ne remplace pas la restauration vérifiée. Les six migrations XP/vocal de #325 sont distinctes des sept migrations Tower ci-dessus.
5. Activer un flag seulement à la demande du propriétaire, un à la fois. Migration vocale, installation du worker et collecte réelle restent distinctes.

Le propriétaire gère la connexion Codex, les invitations, les permissions/rôles Discord et les publications Discord. Aucun secret ne doit figurer dans un fichier, une PR ou un compte rendu.
