---
description: Corrige la CI rouge d'une PR de la boucle roadmap (argument : numéro de PR)
---

Tu corriges la CI GitHub rouge de la PR n° **$ARGUMENTS** (une PR Draft de branche `claude/lot[1-7]-*`), puis tu t'arrêtes. Réponses courtes, en français. Mêmes garde-fous que `/next-item` (section 0) : jamais de merge ni de `gh pr ready`, jamais `.env*`, jamais Neon, pas de nouvelle dépendance, ne modifie ni `.github/`, `.claude/`, `scripts/work-roadmap.ps1`, `scripts/roadmap-*`, `package.json`, `package-lock.json`, `vercel.json`, `next.config.*`, ni une migration existante.

1. `git fetch origin`, `git status --short` doit être propre (sinon `ECHEC : worktree sale`). `gh pr view $ARGUMENTS --json headRefName,baseRefName,state` : si la base n'est pas `main` ou l'état pas `OPEN`, `ECHEC : PR inattendue`. `git switch <headRefName>` puis `git merge-base --is-ancestor origin/<headRefName> HEAD` doit réussir.
2. `gh run list --branch <headRefName> --limit 1 --json databaseId`, puis `gh run view <id> --log-failed` : repère la ou les commandes en échec et la cause réelle (ne devine pas).
3. Corrige **dans la même branche** : test d'abord si un comportement change, puis le code. Ne supprime pas et ne désactive pas un test pour le faire passer, sauf s'il est faux : dis pourquoi.
4. Vérifie localement ce qui était rouge : `npx next typegen`, `npx tsc --noEmit`, `npm run lint`, `npx next build`, et `npx vitest run <fichier>` pour les tests concernés (un test d'intégration Postgres : `TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_test npx vitest run <fichier>`).
5. Commit en français `fix(ci): …`, `git push origin <headRefName>` (jamais de force-push). Affiche `CI CORRIGEE : $ARGUMENTS` et arrête-toi. Si tu ne trouves pas la cause ou ne peux pas corriger sans enfreindre un garde-fou : `ECHEC : <raison>`.
