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
- `community-domains.integration.test.ts -t "récap : même mois" --pool=forks --maxWorkers=1`: 1/1 réussi sur PostgreSQL local dédié après contrôle lecture seule du conteneur, port et base; aucun autre worker PostgreSQL lancé.
- `src/lib/community-highlights.integration.test.ts`: 6/6 réussi sur le Postgres dédié. Avant exécution, vérification lecture seule : conteneur `gamenight-portable1-pg`, port exposé `127.0.0.1:55440`, `current_database()=gamenight_portable1_test`; DSN construit seulement en mémoire et jamais imprimé.
- ESLint ciblé et `git diff --check` verts au dernier commit avant les présentes seules mises à jour documentaires.
- Audits XP sans migration : `superlative-voting.test.ts`, `seasons.test.ts`, `xp.test.ts` 42/42; `community-progress-views.integration.test.ts` 12/12 et `xp-shop.integration.test.ts` 3/3, séquentiellement sur Postgres local. L’achat est confirmé comme décrémentant la même valeur utilisée pour le rang.
- Intégrations locales additionnelles, chacune séquentielle : `game-warnings.integration.test.ts` 4/4; `session-lifecycle.integration.test.ts` 10/10. Elles confirment warning `motionSickness` et création de soirée sans rôle admin côté action.
- PWA/Push unitaires : service worker/config/delivery/subscription 16/16; le service worker ne met en cache que `/offline.html`; Push réel reste non configuré.
- Le test mensuel `community-domains.integration.test.ts -t "récap : même mois"` a d’abord échoué au seeding (slug `default` déjà existant). Après confirmation en lecture seule de la DB dédiée et zéro requête concurrente, un lancement isolé `--pool=forks --maxWorkers=1` a passé 1/1 (21 ignorés); aucun nettoyage manuel de la base. La cause du premier incident n’est pas démontrée, un chevauchement de processus est possible.
- La recette locale authentifiée de #289 est déjà acquise et ne doit pas être rejouée. Toute suite Postgres ultérieure reste sérielle et nécessite la vérification de destination adaptée avant les écritures.
- Vérification antérieure : l’API branch protection de `main` a retourné 404 « Branch not protected ». Les checks associés à la PR sont apparus ensuite; voir l’état daté ci-dessous et ne pas poller en boucle.
- Mise à jour de reprise : le commit `6cbfc99070bddfa24f96dd0c48136f1fbe8758f4` a ajouté le classement `playCount`; la PR reste brouillon. À la dernière lecture, Vercel était `PENDING` pour ce SHA et les checks CI n’avaient pas encore été rapportés. Le connecteur Vercel sans équipe avait confirmé `READY` pour le déploiement précédent `0bc983d`, mais les alias/URL restent protégés (`web_fetch_vercel_url` 403 `read_protection_bypass`). Avec l’équipe explicite `team_gho4DTcbV8MSZicSAIroYF9c`, l’API deployment est refusée 403; `vercel` CLI n’est pas installé. Pas d’E2E navigateur dans le dépôt. Ne pas reconnecter sans changement de permissions/portée.

## Prochaine action exacte

1. Le classement par soirées rejouées et le checkpoint sont poussés; consulter une fois les checks du SHA courant et traiter tout échec. Ne pas poller en boucle.
2. Revoir les permissions de galerie : décider à partir des rôles déjà définis si `ADMIN`/`OWNER` de la communauté peuvent gérer les médias et les voir sans devenir invité d’une soirée privée. Ne pas accorder un bypass global de lecture des soirées. Tant que ce point n’est pas résolu, garder la PR brouillon. Pour la recette navigateur, il faut rétablir l’autorisation du connecteur Vercel sur l’équipe/projet concernés (voir 403 ci-dessus) ou fournir un accès navigateur humain au Preview protégé; ne pas modifier les protections Vercel.
3. Décision économique à conserver dans la liste commune : `xpTotal` sert à la fois de score/niveau et de solde acheté/misé, et la saison le remet à zéro. Ne pas séparer ces rôles ni migrer les valeurs sans arbitrer l’effet sur rang, pari, pénalité et solde au reset; continuer entre-temps les fonctions indépendantes.
4. Continuer les tâches indépendantes selon `docs/MISSION-20261019.md`; distinguer validation manquante de fonction absente et ne pas réduire le périmètre par documentation.
5. Les six intégrations Postgres Lore sont acquises; ne pas les rejouer sans changement pertinent. Pour une autre suite, revalider la cible avant écriture et ne jamais lancer deux suites PostgreSQL en parallèle.
6. Pour toute nouvelle PR, tests pertinents au dernier commit, revue, checks GitHub et statut de déploiement requis avant fusion. Si un blocage demeure, garder la PR brouillon et consigner la cause précise dans ce fichier et `docs/MISSION-20261019.md`.

## Interventions humaines probablement requises

- Vérifier au navigateur un utilisateur administrateur communautaire et un invité non-créateur; distinguer admin communautaire d’admin global pour la galerie.
- Vercel/Neon Preview reste bloquée par l’accès/configuration déjà décrits dans `logs/HANDOFF_PORTABLE1.md`; ne pas reconnecter pour les lectures projet qui réussissent déjà. N’utiliser aucune Preview avant confirmation privée de sa destination isolée.
- Pour les offres Epic/Steam, l’intervention réseau exacte est de faire approuver la chaîne racine TLS pour `www.gamerpower.com` ou fournir une réponse/specification primaire actuelle (sans désactiver la validation TLS), notamment expiration/région. L’erreur est `AuthenticationException: UntrustedRoot`. La candidate permet un usage commercial avec attribution, mais l’import reste non codé tant que schéma et couverture régionale ne sont pas vérifiés.
