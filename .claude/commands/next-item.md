---
description: Traite UN élément de docs/ROADMAP.md (plan, TDD, PR Draft vers main) puis s'arrête
---

Tu traites **un seul** élément de `docs/ROADMAP.md`, puis tu t'arrêtes. Réponses courtes, en français.
Lis d'abord `CLAUDE.md` et `docs/REPRISE_AUTONOME.md`, puis `docs/ROADMAP.md`. Utilise l'outil **Bash** pour git/gh/npm.

**Tu ne fusionnes jamais.** Le script `scripts/work-roadmap.ps1` (hors de toi) passe la PR en « ready », la fusionne dans `main` et surveille le déploiement, seulement si une porte déterministe et la CI sont vertes. Ta seule sortie est une PR **Draft** vers `main`.

## 0. Garde-fous (non négociables)

- Jamais `bypassPermissions`, jamais `gh pr merge`, `gh pr ready`, `git merge`, force-push, `reset --hard`, déploiement.
- Jamais lire ni modifier un `.env*` (sauf `.env.example`). Jamais la base Neon, jamais `neon.tech`. Tests uniquement sur le Postgres local 127.0.0.1:55439.
- Jamais de vraie notification Discord depuis un test ou un essai. Aucune nouvelle dépendance : **ne modifie ni `package.json`, ni `package-lock.json`, ni `vercel.json`, ni `next.config.*`**.
- **Ne modifie jamais** `.github/`, `.claude/`, `scripts/work-roadmap.ps1`, `scripts/roadmap-*`, `src/lib/roadmap-gate.test.ts` : la boucle ne se modifie pas elle-même (la porte refuserait la PR).
- Migration Prisma existante immuable. Toute nouvelle migration, même additive, exige une revue explicite hors auto-fusion : étape 3. La porte SQL ne prouve pas l'absence d'effets de bord des expressions PostgreSQL.
- Tout nouveau modèle : `communityId` obligatoire, client scopé (`getScopedPrisma`), tests d'isolation. Dates : `wallClockNow()`. Notifications : système existant (`enqueue`). Interface en français, mobile d'abord. Mise à jour de `/guide` si la fonction est visible.

## 1. Choisir l'élément

1. `git fetch origin`. `git status --short` ne doit montrer aucun fichier suivi modifié, sinon `ELEMENT BLOQUE : worktree sale`. `git switch --detach origin/main` et lis **`docs/ROADMAP.md` dans cet état**.
2. **Reprise d'orpheline** : liste les branches `origin/claude/lot*` sans aucune PR (`gh pr list --state all --head <branche>`). S'il en existe une, ne crée rien : `git switch` dessus, reprends à l'étape 4.5, puis ouvre sa PR vers `main` (étapes 4.6-4.7).
3. Sinon, parcours les lots 1 → 7 dans l'ordre des tableaux et retiens le premier élément de **Statut `À faire`** et **Nature `code`**. Ignore `PR ouverte`, `Fait`, `ÉCHEC`, `À TOI`. Le statut du fichier fait foi.
4. Aucun candidat : affiche `ROADMAP TERMINEE` et arrête-toi.
5. Vérifie sur `origin/main` que l'élément n'existe pas déjà (`graphify query`, puis grep). S'il existe : étape 6 avec le statut `Fait`.

## 2. Cartographier et planifier (court)

Fichiers, modèles, routes et tests touchés ; plan en 5-10 lignes. `verificateur-main` pour vérifier, `implementeur-lot` pour implémenter si utile, `relecteur-isolation-securite` sur la diff avant la PR (corrige les « Bloquant »).

## 3. Blocage humain (`À TOI`)

Si l'élément exige un **secret**, un **service externe non configuré**, une **décision produit** ou une nouvelle migration : n'écris aucun code. Étape 6 avec `À TOI — <raison courte et question précise>`, puis affiche `ELEMENT BLOQUE : <ID> — <explication>`. Ce n'est pas un échec.

## 4. Implémenter

1. `git switch -c claude/lotN-nom-court origin/main` (N = lot, `nom-court` en minuscules/chiffres/tirets).
2. Base de test : `docker ps` doit montrer `gamenight-test-pg`, sinon `ELEMENT BLOQUE : <ID> — base de test absente`. Après une nouvelle migration : `DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npx prisma migrate deploy` (aucune variable de base n'est exportée dans ta session : seules les formes préfixées de cette section sont autorisées).
3. **TDD** : test d'abord, vu en rouge, puis implémentation, puis vert. Pas de refactor large, pas de `try/catch` silencieux.
4. Fonctionnalité visible derrière un interrupteur `*_ENABLED`, **éteint par défaut** (actif seulement si la valeur vaut exactement `true`), ajouté à `.env.example` avec son commentaire et à la liste des interrupteurs de `CLAUDE.md`.
5. **Vert local** = `npx next typegen` (avant `tsc` : les types de Next sont absents d'un checkout neuf), `npx tsc --noEmit`, `npm run lint`, `npx next build` (jamais `npm run build`), plus les tests **ajoutés ou modifiés** par l'élément : `npx vitest run <fichier>` ; pour un test d'intégration Postgres, `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npx vitest run <fichier>` (un fichier à la fois). `npm test` et `npm run test:postgres` complets ne sont **pas** exigés en local : la CI GitHub fait foi. Si tu lances quand même `npm test` complet (sans `TEST_DATABASE_URL`, sinon les suites Postgres partent en parallèle) : un échec « Test timed out in 5000ms » sur `src/app/onboarding-links.test.tsx` est connu sur cette machine (passe seul, échoue aussi sur `main`) ; relance ce fichier seul (`npx vitest run <fichier>`) et ne le compte pas comme un échec. Un test « skipped » est signalé, jamais présenté comme passé. Plusieurs essais de correction sont permis ; sinon étape 5.
6. Mets la ligne de l'élément à `Fait` dans `docs/ROADMAP.md` (c'est l'état voulu après fusion). Commits en français `type(scope): …`, fichiers ajoutés un par un (jamais `git add -A`, jamais `.gitignore`). Avant `git push -u origin <branche>`, relève `git ls-remote origin refs/heads/<branche>` : si la branche existe déjà, arrête-toi sans pousser et conserve ton travail pour réconciliation ; jamais de force-push.
7. `gh pr create --draft --base main` : **titre** `type(scope): … [<ID>]` ; **description** : si migration, première ligne **MIGRATION** ; fait · tests (sautés signalés) · fichiers de prod modifiés · interrupteur à activer · à tester à la main · ligne « Plugins et skills utilisés : … » · tableau étape → sous-agent → modèle ; et, en dernière ligne, le marqueur exact `<!-- roadmap-item: <ID> -->`. Termine par `PR OUVERTE : <url>` et arrête-toi.

## 5. Échec

Si le vert local reste rouge ou si l'élément est impossible : **ne pousse pas le code**. Conserve les modifications et la branche locale ; affiche `ECHEC : <ID> — <raison : commande, erreur>`. Ne supprime aucun travail pour produire une PR de statut.

## 6. PR de statut seul (`ÉCHEC`, `À TOI`, `Fait`)

`git switch -c claude/lotN-<id en minuscules>-statut origin/main` (ex. `claude/lot3-l3-02-statut`). Ne change que la dernière cellule de la ligne de l'élément dans `docs/ROADMAP.md` (statuts : `Fait`, `ÉCHEC — raison`, `À TOI — raison`, sans `|`). Commit `docs(roadmap): <ID> <statut>`, push, `gh pr create --draft --base main` avec titre `docs(roadmap): <ID> <statut> [<ID>]` et le marqueur `<!-- roadmap-item: <ID> -->` en dernière ligne de la description. **Aucun autre fichier** (la porte refuse). Termine par `PR OUVERTE : <url>` (en plus de `ELEMENT BLOQUE` / `ECHEC`).
