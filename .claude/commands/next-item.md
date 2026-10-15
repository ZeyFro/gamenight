---
description: Traite UN élément de docs/ROADMAP.md (plan, TDD, PR Draft) puis s'arrête
---

Tu traites **un seul** élément de `docs/ROADMAP.md`, puis tu t'arrêtes. Réponses courtes, en français.
Lis d'abord `CLAUDE.md` et la section « Règles de travail » de `docs/ROADMAP-claude-code.md` (elles s'appliquent, sauf l'arrêt par lot : ici le plafond de 3 PR le remplace). Utilise l'outil **Bash** pour git/gh/npm.

## 0. Garde-fous (non négociables)

- Jamais `bypassPermissions`, jamais de merge (`gh pr merge`, `git merge`), de déploiement, de force-push, de `reset --hard`.
- Jamais lire ni modifier un `.env*` (sauf `.env.example`). Jamais la base Neon, jamais de commande contenant `neon.tech`. Tests uniquement avec `TEST_DATABASE_URL` (Postgres local 127.0.0.1:55439).
- Jamais de vraie notification Discord depuis un test ou un essai. Aucune nouvelle dépendance, aucune modification de la CI.
- Migration Prisma existante immuable. Nouvelle migration seulement si **purement additive** (ni DROP, ni suppression/renommage de colonne, ni changement de type) ; sinon arrêt (étape 3).
- Tout nouveau modèle : `communityId` obligatoire, client scopé (`getScopedPrisma`), tests d'isolation. Dates : `wallClockNow()`. Notifications : système existant (`enqueue`). Interface en français, mobile d'abord. Mise à jour de `/guide` si la fonction est visible.

## 1. Choisir l'élément

1. `git fetch origin`. Compte les PR ouvertes de branches `claude/*` :
   `gh pr list --state open --json headRefName --jq '[.[]|select(.headRefName|startswith("claude/"))]|length'`.
   Si ≥ 3 : ne code rien, affiche `EN ATTENTE DE RELECTURE` et arrête-toi.
2. Lis `docs/ROADMAP.md` (version de `origin/main`) et `logs/roadmap-bloques.txt` s'il existe.
3. Parcours les lots 1 → 6 dans l'ordre des tableaux. Retiens le premier élément de **Statut `À faire`** et **Nature `code`**, qui n'est pas dans `logs/roadmap-bloques.txt`, et pour lequel **aucune** branche `claude/lotN-*` n'existe déjà (`git ls-remote --heads origin 'claude/lotN-*'` et `git branch --list 'claude/lotN-*'`, N = numéro du lot) dont le nom correspond à l'élément. Ignore le « Lot actuel », « Hors lot » et « Fait ».
4. Aucun candidat : affiche `ROADMAP TERMINEE` et arrête-toi.
5. Vérifie sur `origin/main` que l'élément n'existe pas déjà (`graphify query` d'abord, puis grep). S'il existe : passe son statut à `Fait` dans une PR docs minimale, ou signale-le, puis arrête-toi.

## 2. Cartographier et planifier (court)

Liste fichiers, modèles et routes touchés, et les tests. Plan en 5-10 lignes. Utilise `verificateur-main` pour la vérification, `implementeur-lot` pour l'implémentation si utile, et `relecteur-isolation-securite` sur la diff avant d'ouvrir la PR (corrige les « Bloquant »).

## 3. Arrêt sans code

Si l'élément exige un **secret** (clés VAPID, jeton…), un **service externe non configuré**, un montant/limite/règle de **produit à décider** (XP, taille d'upload, durées…) ou une migration non additive : n'écris aucun code. Ajoute la ligne `ID raison courte` à `logs/roadmap-bloques.txt` (crée le dossier si besoin), puis affiche `ELEMENT BLOQUE : <ID> — <explication et question précise>` et arrête-toi.

## 4. Implémenter

1. `git switch -c claude/lotN-nom-court origin/main` (dans le worktree courant).
2. Base de test : vérifie que le conteneur `gamenight-test-pg` tourne (`docker ps`). Sinon, arrête-toi avec `ELEMENT BLOQUE : <ID> — base de test absente`. Après une nouvelle migration : `npx prisma migrate deploy` (la variable `DATABASE_URL` locale est fournie par le script).
3. **TDD** : écris d'abord le test, vois-le échouer (rouge), puis implémente, puis vert. Pas de refactor large, pas de `try/catch` silencieux.
4. Fonctionnalité visible derrière un interrupteur `*_ENABLED`, **éteint par défaut** (actif seulement si la valeur vaut exactement `true`), ajouté à `.env.example` avec son commentaire, et à la liste des interrupteurs de `CLAUDE.md`.
5. Vérifications, toutes vertes avant la PR : `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:postgres`, `npx next build` (jamais `npm run build`). Un test « skipped » est signalé, jamais présenté comme passé.
6. Mets à jour la ligne de l'élément dans `docs/ROADMAP.md` : `PR ouverte #n` (corrige le numéro après création de la PR si besoin).
7. Commits en français, style `type(scope): …`, ajoute les fichiers un par un (jamais `git add -A`, jamais `.gitignore`). `git push -u origin <branche>`, puis `gh pr create --draft --base main`.

## 5. Rapport (description de la PR)

Titre `type(scope): …`. Si migration : première ligne **MIGRATION**. Sections : fait · tests (sautés signalés) · fichiers de prod modifiés · interrupteur à activer · à tester à la main · ligne « Plugins et skills utilisés : … » · tableau étape → sous-agent → modèle. Termine par `PR OUVERTE : <url>` puis arrête-toi. Ne vérifie pas Vercel en boucle ; ne sors pas la PR du Draft.
