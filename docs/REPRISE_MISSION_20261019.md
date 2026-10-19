# Point de reprise — mission GameNight du 19 octobre 2026

Ce point est suivi dans Git afin de survivre à une reprise sur un autre poste. Le quota restant n’était pas observable; ne pas déduire ni annoncer de pourcentage.

## État Git et PR

- Worktree : `.codex-worktrees/reprise-portable1`, branche `work/mission-complete-20261019`, basée sur `origin/main` `babf958c869a745ad20f02b9c4d58326a9a0bdd8` (#289 fusionnée).
- PR brouillon : [#290 — Durcir la galerie et compléter les classements communautaires](https://github.com/ZeyFro/gamenight/pull/290). Ne pas fusionner tant que la politique admin n’est pas complétée, les validations nécessaires ne sont pas vertes au dernier SHA et aucun défaut bloquant ne reste.
- Préserver `fix/recette-locale-authentifiee`, les autres worktrees, `docs/ROADMAP.md` et `logs/HANDOFF_PORTABLE1.md` (ignoré par Git). Ne pas faire de nettoyage distant.
- Aucune récupération d’ancienne Preview à poursuivre; pas d’écriture Production, aucun message Discord réel, pas d’activation de flag.

## Travail déjà fait dans la PR

- Upload et suppression des médias de galerie réservés au créateur côté actions serveur; les contrôles correspondants sont cachés aux invités côté interface.
- Création, modification et suppression de Lore communautaire réservées aux membres `ADMIN`/`OWNER` de la communauté. Les membres restent lecteurs.
- `/classement` expose aussi le nombre de soirées terminées par jeu, trié par `GroupGameStat.playCount`, à côté du temps déclaré et de la régularité. Les agrégats restent limités à la communauté sélectionnée; aucune migration ni donnée historique modifiée.
- `docs/MISSION-20261019.md` suit chaque exigence et sépare code, tests, recette, configuration et preuve. Les décisions encore ambiguës y sont listées.
- `docs/ROADMAP.md` garde les cadrages antérieurs comme propositions à valider; ne pas les transformer en décisions sans réponse explicite.

## Vérifications acquises

- `npm exec vitest run src/app/sessions/actions/gallery.test.ts src/components/sessions/SessionGallery.test.tsx`: 7/7 réussi.
- `npm exec vitest run src/lib/community-highlights.authorization.test.ts src/lib/community-highlights.test.ts`: 12/12 réussi.
- `npm exec -- vitest run src/lib/scoreboard.isolation.test.ts`: 10/10 réussi après le classement par soirées rejouées; ESLint ciblé et `git diff --check` verts.
- Carnet joueur sans DB : identifiants, équipement, préférences, quiz et composants profil 40/40; disponibilité/sondage 15/15 (`availability.test.ts`, `session-availability-poll.test.ts`). Aucun parcours privé multi-compte navigateur validé.
- Tournois sans DB/Discord : bracket, scores, tirage d’équipes, RSVP, pronostics et composants 44/44; les annonces Discord réelles et les parcours authentifiés restent non vérifiés.
- Mini-jeu existant « devine le jeu » (trois indices) : logique, composant et page 7/7; aucun quiz de connaissances distinct trouvé. Dessin proposé en attente de validation avant code.
- Sondages éclair, validation d’entrée et action serveur avec doubles : `community-quick-polls-input.test.ts` et `sondages/actions.test.ts` 30/30; aucune écriture Postgres/Discord.
- Dates calendrier et consentement anniversaires : `calendar-dates.test.ts` + `community-dates.test.ts` 17/17; test navigateur/visibilité multi-compte restant.
- Export iCal et routes protégées : `ical-calendar.test.ts`, `calendar-feed.test.ts`, `api-routes-auth.test.ts` 17/17; aucun import réel dans Google Calendar ou Apple Calendar.
- Présence, bonus/pénalités et paramètres communautaires : `session-attendance.test.ts` + `community-admin.test.ts` 43/43; aucune valeur d’économie modifiée.
- Préparation jeux/soirées sans DB : actions, champs de prix/gratuité/inconnu, checklist et guide/components 37/37; configuration `SESSION_PREPARATION_ENABLED`/`GAME_PREPARATION_TIME_ENABLED` et recette authentifiée manquantes.
- LFG/petites annonces : service et contrôle d’accès `player-classifieds.test.ts` + `.access.test.ts` 5/5; flag communautaire et parcours navigateur non vérifiés.
- Roulette/veto/tirage, composants et préférences Discord avec doubles : 50/50 sans Postgres ni message réel; flags/configuration et recette Discord manquants.
- Galerie image/MP4 : actions, composants, route privée/range et règles de format/flag 19/19 avec Blob simulé; aucun Blob réel, flag activé ou rôle admin galerie ajouté.
- Bibliothèques/wishlist : page groupe, suggestions et cron Steam pleine 15/15; alertes prix 4/4; `community-library-stats.integration.test.ts` 13/13 et `game-library.integration.test.ts` 17/17 sur le Postgres local dédié, exécutés en série après confirmation de la destination. La recette multi-compte Preview reste non vérifiée.
- Guide/charte : `guide-sections.test.ts`, `fair-play-charter.test.ts`, action `charte/actions.test.ts` 15/15; contenu configuré et parcours navigateur/mobile non validés.
- Lien du salon vocal selon la configuration communautaire : `community-channels.test.ts` 35/35; salon et ouverture cliente Discord réels non testés.
- Rappels/RSVP Discord : schedule, contenu, transport et interactions 68/68 avec doubles; aucun message réel, cron ou webhook vérifié.
- Séries récurrentes : logique d’occurrences et annulation `session-recurrence.test.ts` + test d’action 8/8; l’édition des séries futures n’est pas implémentée ni validée comme décision.
- `community-domains.integration.test.ts -t "récap : même mois" --pool=forks --maxWorkers=1`: 1/1 réussi sur PostgreSQL local dédié après contrôle lecture seule du conteneur, port et base; aucun autre worker PostgreSQL lancé.
- `src/lib/community-highlights.integration.test.ts`: 6/6 réussi sur le Postgres dédié. Avant exécution, vérification lecture seule : conteneur `gamenight-portable1-pg`, port exposé `127.0.0.1:55440`, `current_database()=gamenight_portable1_test`; DSN construit seulement en mémoire et jamais imprimé.
- ESLint ciblé et `git diff --check` verts pour les changements de code; après le classement par `playCount`, `next typegen`, `tsc --noEmit` et `next build` passent. Aucun `npm ci` ni script de migration n'a été relancé.
- Audits XP sans migration : `superlative-voting.test.ts`, `seasons.test.ts`, `xp.test.ts` 42/42; `community-progress-views.integration.test.ts` 12/12 et `xp-shop.integration.test.ts` 3/3, séquentiellement sur Postgres local. L’achat est confirmé comme décrémentant la même valeur utilisée pour le rang.
- Intégrations locales additionnelles, chacune séquentielle : `game-warnings.integration.test.ts` 4/4; `session-lifecycle.integration.test.ts` 10/10. Elles confirment warning `motionSickness` et création de soirée sans rôle admin côté action.
- PWA/Push unitaires : service worker/config/delivery/subscription 16/16; le service worker ne met en cache que `/offline.html`; Push réel reste non configuré.
- Le test mensuel `community-domains.integration.test.ts -t "récap : même mois"` a d’abord échoué au seeding (slug `default` déjà existant). Après confirmation en lecture seule de la DB dédiée et zéro requête concurrente, un lancement isolé `--pool=forks --maxWorkers=1` a passé 1/1 (21 ignorés); aucun nettoyage manuel de la base. La cause du premier incident n’est pas démontrée, un chevauchement de processus est possible.
- La recette locale authentifiée de #289 est déjà acquise et ne doit pas être rejouée. Toute suite Postgres ultérieure reste sérielle et nécessite la vérification de destination adaptée avant les écritures.
- Vérification antérieure : l’API branch protection de `main` a retourné 404 « Branch not protected ». Les checks associés à la PR sont apparus ensuite; voir l’état daté ci-dessous et ne pas poller en boucle.
- Mise à jour 19 octobre : PR #290 reste brouillon. Le code fonctionnel a été vérifié sur `993678b9feb5a67bc741bcb476fe967795b2f5be`; le checkpoint documentaire suivant (`16c01aafca1a4c9350fc861364d6d50a8d759ca1`) ne modifie que ces deux fichiers de suivi. Sur le commit de code, Vercel et Vercel Preview Comments passent. Au checkpoint documentaire, Preview Comments passe mais Vercel est `PENDING`. Aucun de ces statuts ne vaut recette navigateur : le connecteur ne peut toujours pas lire l’URL protégée (`read_protection_bypass`), et aucune suite E2E n’existe dans le dépôt. Avec l’équipe explicite `team_gho4DTcbV8MSZicSAIroYF9c`, l’API deployment est refusée 403; `vercel` CLI n’est pas installé. Ne pas reconnecter sans changement de permissions/portée.

## Prochaine action exacte

1. Sur le dernier commit fonctionnel, Vercel et Vercel Preview Comments passent. Le checkpoint documentaire déclenche un nouveau statut Vercel qui était `PENDING` lors de la dernière lecture; une seule vérification ultérieure suffit. PR #290 reste brouillon; il n'existe pas de preuve E2E navigateur ni de validation multi-compte Preview.
2. Revoir les permissions de galerie : décider à partir des rôles déjà définis si `ADMIN`/`OWNER` de la communauté peuvent gérer les médias et les voir sans devenir invité d’une soirée privée. Ne pas accorder un bypass global de lecture des soirées. Tant que ce point n’est pas résolu, garder la PR brouillon. Pour la recette navigateur, il faut rétablir l’autorisation du connecteur Vercel sur l’équipe/projet concernés (voir 403 ci-dessus) ou fournir un accès navigateur humain au Preview protégé; ne pas modifier les protections Vercel.
3. Décision économique à conserver dans la liste commune : `xpTotal` sert à la fois de score/niveau et de solde acheté/misé, et la saison le remet à zéro. Ne pas séparer ces rôles ni migrer les valeurs sans arbitrer l’effet sur rang, pari, pénalité et solde au reset; continuer entre-temps les fonctions indépendantes.
4. Continuer les tâches indépendantes selon `docs/MISSION-20261019.md`; distinguer validation manquante de fonction absente et ne pas réduire le périmètre par documentation.
5. Les six intégrations Postgres Lore sont acquises; ne pas les rejouer sans changement pertinent. Pour une autre suite, revalider la cible avant écriture et ne jamais lancer deux suites PostgreSQL en parallèle.
6. Pour toute nouvelle PR, tests pertinents au dernier commit, revue, checks GitHub et statut de déploiement requis avant fusion. Si un blocage demeure, garder la PR brouillon et consigner la cause précise dans ce fichier et `docs/MISSION-20261019.md`.

## Interventions humaines probablement requises

- Vérifier au navigateur un utilisateur administrateur communautaire et un invité non-créateur; distinguer admin communautaire d’admin global pour la galerie.
- Vercel : `get_deployment(id)` sans équipe retourne les métadonnées; avec l’équipe explicite, l’API renvoie 403 `forbidden` sur `mpmaximeparisot-6230s-projects` (team ID `team_gho4DTcbV8MSZicSAIroYF9c`). Projet `gamenight` (`prj_mYqfA5QbVptMFRgAbtw18vE23cSo`); le déploiement est créé par le compte Vercel `mpmaximeparisot-6230`. L’appel alias/URL échoue à l’étape d’accès du connecteur (`read_protection_bypass`), donc la protection HTTP du site elle-même n’a pas été vérifiée. Action humaine : dans les paramètres Apps de ChatGPT/Codex, reconnecter Vercel avec le compte ayant accès à cette équipe et autoriser la lecture du projet `gamenight`; à défaut, accorder à ce compte un rôle de lecture sur ce projet/équipe. Ne pas désactiver ni élargir la protection Vercel. Le CLI Vercel n’est pas installé; aucune reconnexion n’a été relancée.
- Neon Preview reste bloquée par l’accès/configuration déjà décrits dans `logs/HANDOFF_PORTABLE1.md`; ne pas reconnecter pour les lectures projet qui réussissent déjà. N’utiliser aucune Preview DB avant confirmation privée de sa destination isolée.
- Offres Epic/Steam : le lecteur web a pu voir un exemple officiel Steam; `end_date` peut valoir `N/A`, pas de champ de région, et l’exemple exige des points alors que les règles excluent les offres à points/crédits. L’API autorise l’usage commercial avec attribution, mais aucun filtre ni couverture régionale fiable n’est validé. L’accès direct depuis le poste reste bloqué par `AuthenticationException: UntrustedRoot`; ne pas désactiver TLS. L’automatisation reste absente.
