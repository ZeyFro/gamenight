# L3-06 — Checklist de préparation

- Relevé UTC : 2026-10-16T09:03:01.078Z.
- Base : origin/main, 5724728501d5ebdcf680702aa7a5056d14c37cf6 (fetch effectué).
- Worktree : C:/Users/mparisot/gamenight/.codex-worktrees/preparation-checklist.
- Branche : feat/checklist-preparation. Aucune PR, aucun push ni merge demandé/effectué.
- Checkout principal, worktrees Claude et resume-234 non modifiés.

## Périmètre livré

Quatre cases par participant du jeu retenu : installé, mis à jour, micro testé, lobby prêt. Lecture collective réservée aux personnes autorisées à voir la soirée ; écriture réservée au participant connecté sur sa ligne. Places confirmées si capacité définie, sinon votes du jeu retenu. Le créateur non participant ne peut pas cocher. Invitations actives et portée communautaire passent par les contrôles existants (accessibleSessionWhere, scopedDb, communityMemberUserWhere, lockCreationMembers). Pas de nouvelle définition globale des participants.

Les lectures et écritures enfant passent exclusivement par le parent Session scopé. La transaction relit le parent après verrouillage et verrouille ses invitations ; l'appartenance de l'acteur est revalidée selon le contrat d'isolation existant. Isolation OFF conserve le comportement communautaire historique et impose toujours la confidentialité des invitations. État absent : quatre cases fausses. État séparé par jeu ; revenir sur un jeu déjà préparé retrouve ses cases. Les soirées autres que SCHEDULED ne montrent pas la checklist.

SESSION_PREPARATION_ENABLED : OFF par défaut (seul true exact active). Migration additive 20261016120000_session_preparation à appliquer avant activation ; table distincte avec suppression en cascade par soirée/utilisateur. Désactivation sans suppression des données. Guide et .env.example documentés.

## Validation exécutée

- npm ci --ignore-scripts --no-audit --no-fund : installation locale isolée, aucun changement des manifests/lockfiles.
- npx prisma generate : réussi, génération locale seulement.
- npx next typegen puis npx tsc --noEmit : réussis.
- ESLint ciblé sur les fichiers TypeScript/TSX touchés : réussi.
- git diff --check : réussi.
- npx vitest run src/lib/session-preparation.test.ts src/lib/session-preparation-guide.test.ts src/app/sessions/actions/preparation.test.ts src/components/sessions/SessionPreparationPanel.test.tsx src/lib/community-scope.test.ts src/lib/community-scoped-client.test.ts src/lib/use-server-exports.test.ts src/lib/env-example.test.ts src/lib/env-example-no-secrets.test.ts src/lib/guide-sections.test.ts : 10 fichiers, 95 tests réussis, aucun ignoré.
- Première passe : échecs du mock incomplet de community-isolation et du flag renseigné dans .env.example ; corrigés avant la passe verte.
- Revue statique : contrôle identité, frontières parent/enfant, cases accessibles via labels et fieldsets, erreurs visibles, pas d'état optimiste trompeur. Skill React appliqué. Sous-agents indisponibles, revue locale.

## Limites et reprise

Aucun accès Neon, aucune notification Discord réelle, aucune migration appliquée, aucun test Postgres, aucun build ni parcours navigateur. Tests de sécurité unitaires avec doubles de base : ils vérifient les filtres et les refus, pas l'exécution SQL ni les courses réelles. Le compteur collectif s'actualise au chargement/rafraîchissement de la page, sans temps réel ajouté. Aucun changement CI ou dépendances, aucune estimation de téléchargement ou durée ajoutée.

Avant activation ultérieure : appliquer et vérifier la migration sur une base de test jetable, puis vérifier le parcours réel. Ces vérifications restent hors de ce lot borné.

## Complément : suites Postgres (2026-10-16T09:05:37.766Z)

Ajout de src/lib/session-preparation.integration.test.ts, sur le modèle des suites existantes : Prisma réel via TEST_DATABASE_URL uniquement, describe.skipIf sans URL, fixtures nettoyées par TRUNCATE sur base jetable dédiée. Dix scénarios couvrent création persistée et effacement des quatre cases personnelles, préservation du voisin, identité tierce forgée, invité non participant, tiers non invité, invitation révoquée, membre retiré, isolation entre communautés et soirées, places confirmées/attente, conservation intégrale des métadonnées de soirée/invitations/votes/jeu et absence de livraisons, séparation par jeu/flag OFF, cascade utilisateur/soirée.

Validation sans base : TEST_DATABASE_URL retirée de l'environnement du processus de validation ; Vitest ciblé : 22 tests unitaires réussis, 10 tests Postgres explicitement ignorés. Aucune exécution SQL, aucune connexion Neon, aucune base partagée. Les scénarios réels sont écrits mais leur réussite Postgres reste non vérifiée.

Découverte confirmée par vitest list --filesOnly src/lib/session-preparation.integration.test.ts. Le script test-postgres.mjs lance Vitest run --maxWorkers=1 sans filtre de fichiers : vérifié par interception de spawnSync (aucun processus enfant lancé), avec la configuration src/**/*.test.ts inchangée. Aucun changement du script, de la CI ou des dépendances.

Dépendances propres confirmées par Get-Item : node_modules, node_modules/.prisma/client et node_modules/@prisma/client sont des Directory locales, sans ReparsePoint, LinkType ni Target. Source : npm ci --ignore-scripts --no-audit --no-fund dans ce worktree ; prisma generate a écrit seulement dans ce node_modules local. Aucun client généré partagé avec Claude.

Contrôles du complément : npx tsc --noEmit et ESLint ciblé sur la suite d'intégration réussis ; git diff --check réussi.
