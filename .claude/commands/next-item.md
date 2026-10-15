---
description: Traite UN élément de docs/ROADMAP.md (plan, TDD, PR Draft empilée) puis s'arrête
---

Tu traites **un seul** élément de `docs/ROADMAP.md`, puis tu t'arrêtes. Réponses courtes, en français.
Lis d'abord `CLAUDE.md` et « Règles de travail » de `docs/ROADMAP-claude-code.md` (elles s'appliquent, sauf l'arrêt par lot : la boucle n'a pas de plafond de PR). Utilise l'outil **Bash** pour git/gh/npm.

## 0. Garde-fous (non négociables)

- Jamais `bypassPermissions`, jamais de merge (`gh pr merge`, `git merge`), de déploiement, de force-push, de `reset --hard`, ni de `gh pr ready`.
- Jamais lire ni modifier un `.env*` (sauf `.env.example`). Jamais la base Neon, jamais de commande contenant `neon.tech`. Tests uniquement avec `TEST_DATABASE_URL` (Postgres local 127.0.0.1:55439).
- Jamais de vraie notification Discord depuis un test ou un essai. Aucune nouvelle dépendance, aucune modification de la CI (`.github/`).
- Migration Prisma existante immuable. Nouvelle migration seulement si **purement additive** (ni DROP, ni suppression/renommage de colonne, ni changement de type) ; sinon étape 3.
- Tout nouveau modèle : `communityId` obligatoire, client scopé (`getScopedPrisma`), tests d'isolation. Dates : `wallClockNow()`. Notifications : système existant (`enqueue`). Interface en français, mobile d'abord. Mise à jour de `/guide` si la fonction est visible.

## 1. Pointe de la pile, reprise, choix

1. `git fetch origin`. `git status --short` ne doit montrer aucun fichier suivi modifié, sinon arrête-toi avec `ELEMENT BLOQUE : worktree sale`.
2. **Pointe de la pile** = la branche `claude/*` d'une PR **ouverte** qui n'est la base d'aucune autre PR ouverte :
   `gh pr list --state open --json headRefName,baseRefName,createdAt`. Aucune : `origin/main`. Plusieurs (ne devrait pas arriver) : la plus récente. `git switch --detach origin/<pointe>` (ou `origin/main`) et lis **`docs/ROADMAP.md` dans cet état** : c'est lui qui fait foi, pas `origin/main`.
3. **Reprise d'orpheline** : liste les branches `origin/claude/*` sans aucune PR (ni ouverte, ni fermée, ni mergée : `gh pr list --state all --head <branche>`). S'il en existe une, ne crée rien de nouveau : `git switch` dessus, reprends à l'étape 4.5 (vérifications), puis ouvre sa PR (base = pointe de la pile). Cela évite les doublons après une interruption.
4. Sinon, parcours les lots 1 → 7 dans l'ordre des tableaux et retiens le premier élément de **Statut `À faire`** et **Nature `code`**. Ignore les statuts `PR ouverte`, `Fait`, `ÉCHEC`, `À TOI`, « Lot actuel » et « Fait ou à valider ». Le statut du fichier fait foi ; l'existence d'une branche ne suffit pas à sauter un élément.
5. Aucun candidat : affiche `ROADMAP TERMINEE` et arrête-toi.
6. Vérifie sur `origin/main` que l'élément n'existe pas déjà (`graphify query`, puis grep). S'il existe : passe son statut à `Fait` via une branche de statut seul (étape 6), puis arrête-toi.

## 2. Cartographier et planifier (court)

Fichiers, modèles, routes et tests touchés ; plan en 5-10 lignes. `verificateur-main` pour vérifier, `implementeur-lot` pour implémenter si utile, `relecteur-isolation-securite` sur la diff avant la PR (corrige les « Bloquant »).

## 3. Blocage humain (`À TOI`)

Si l'élément exige un **secret** (clés VAPID…), un **service externe non configuré**, une **décision produit** (montants d'XP, limites, règles…) ou une migration non additive : n'écris aucun code. Passe à l'étape 6 avec le statut `À TOI — <raison courte et question précise>`, puis affiche `ELEMENT BLOQUE : <ID> — <explication>`. Ce n'est pas un échec.

## 4. Implémenter

1. `git switch -c claude/lotN-nom-court <pointe de la pile>` (ou `origin/main`). N = numéro du lot. Les fichiers non suivis du worktree restent en place.
2. Base de test : `docker ps` doit montrer `gamenight-test-pg`. Sinon `ELEMENT BLOQUE : <ID> — base de test absente`. Après une nouvelle migration : `npx prisma migrate deploy` (`DATABASE_URL` locale fournie par le script).
3. **TDD** : test d'abord, vu en rouge, puis implémentation, puis vert. Pas de refactor large, pas de `try/catch` silencieux.
4. Fonctionnalité visible derrière un interrupteur `*_ENABLED`, **éteint par défaut** (actif seulement si la valeur vaut exactement `true`), ajouté à `.env.example` avec son commentaire et à la liste des interrupteurs de `CLAUDE.md`.
5. **Vert** = `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:postgres`, `npx next build` (jamais `npm run build`), tous sans erreur. Un test « skipped » est signalé, jamais présenté comme passé. Plusieurs essais de correction sont permis ; sinon étape 5.
6. Mets à jour l'élément dans `docs/ROADMAP.md` : statut `PR ouverte` (sans numéro) ; ajoute une ligne au tableau « Bilan » (lot, ordre = numéro suivant, ID, branche). Commits en français `type(scope): …`, fichiers ajoutés un par un (jamais `git add -A`, jamais `.gitignore`). `git push -u origin <branche>`, puis `gh pr create --draft --base <pointe de la pile, ou main>`.
7. Description de la PR : si migration, première ligne **MIGRATION** ; fait · tests (sautés signalés) · fichiers de prod modifiés · interrupteur à activer · à tester à la main · base de la pile et ordre de merge · ligne « Plugins et skills utilisés : … » · tableau étape → sous-agent → modèle. Termine par `PR OUVERTE : <url>` et arrête-toi. Ne sors jamais une PR du Draft.

## 5. Échec

Si build, lint ou tests restent rouges, ou si l'élément est impossible : **ne pousse pas le code**, ne l'utilise pas comme base. Reviens sur la pointe de la pile (`git switch --detach origin/<pointe>` ; `git branch -D` la branche locale de l'essai). Passe à l'étape 6 avec le statut `ÉCHEC — <raison : commande, erreur>`. Affiche `ECHEC : <ID> — <raison>`.

## 6. Branche de statut seul (`ÉCHEC`, `À TOI`, `Fait`)

`git switch -c claude/lotN-nom-court-statut <pointe de la pile>` ; change seulement la ligne de l'élément (et le « Bilan ») dans `docs/ROADMAP.md` ; commit `docs(roadmap): <ID> <statut>` ; push ; `gh pr create --draft --base <pointe, ou main>` avec la raison et le journal d'erreur dans la description. Elle devient la nouvelle pointe : les statuts s'accumulent. Termine par `PR OUVERTE : <url>` (en plus de `ELEMENT BLOQUE` / `ECHEC`).
