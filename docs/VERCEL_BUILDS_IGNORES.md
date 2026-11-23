# Builds Vercel ignorés (Ignored Build Step)

`vercel.json` définit `"ignoreCommand": "node scripts/vercel-ignore-build.mjs"`. Vercel exécute ce script avant chaque build : **code 0 = build ignoré, code 1 = build exécuté**. La CI GitHub (`verify`, `immutable`) n'est pas concernée.

## Aucun déploiement hors main : `git.deploymentEnabled` (23/11/2026)
Décision de Maxime : `vercel.json` porte `"git": { "deploymentEnabled": { "*": false, "**": false, "main": true } }` en plus de `ignoreCommand`. Vercel ne crée plus de déploiement pour une branche autre que `main` ; la règle « une branche vaut vrai si au moins une règle correspondante vaut vrai » garde `main` actif. `**` est nécessaire en plus de `*` : en syntaxe minimatch, `*` ne traverse pas le `/`, donc `fix/xxx` et `claude/xxx` lui échappaient (constaté le 23/11/2026 : « Canceled by Ignored Build Step » sur une branche `fix/…`). La doc Vercel ne dit pas si les pull requests sont couvertes ni si un déploiement évité sort du compteur de 100 par jour : l'effet est à CONSTATER.

**Retour arrière immédiat** si un déploiement de production de `main` ne réussit plus après cette fusion (hors erreur « Deployment rate limited ») : retirer le bloc `git` de `vercel.json` (revert du commit, aucune autre dépendance) ; `ignoreCommand` continue de limiter les aperçus.

## Règle actuelle (23/11/2026) : seul main est construit
L'offre gratuite plafonne les déploiements par 24 h (limite atteinte le 23/11). Aucun aperçu n'est donc construit par PR ni par mise à jour de branche ; `verify` et `immutable` (GitHub) valident les PR. Un aperçu n'existe que sur **demande explicite** : branche préfixée `preview/` ou `[preview]` dans le message du dernier commit. Production et `main` sont toujours construits ; sans `VERCEL_ENV` (contexte inconnu), on construit par sûreté. Le tableau ci-dessous ne s'applique qu'aux aperçus explicitement demandés.

## Règle de sûreté (aperçu demandé)
On n'ignore un build que si l'on a **prouvé** que tous les fichiers modifiés depuis le dernier déploiement réussi de la branche sont hors application. Au moindre doute, on construit.

| Cas | Résultat |
|---|---|
| Production (`VERCEL_ENV=production`) ou branche `main` | construit |
| Premier déploiement d'une branche (pas de SHA précédent) | construit |
| SHA précédent absent du clone, git en échec, liste vide | construit |
| Au moins un fichier applicatif modifié (`src/`, `prisma/`, `public/`, `package.json`, `package-lock.json`, `vercel.json`, `next.config.*`, `tsconfig.json`, `scripts/build.mjs`, tests inclus…) | construit |
| Uniquement `docs/`, `.github/`, `.claude/`, `scripts/neon-test/` ou un `*.md` à la racine | **ignoré** |

La liste ignorable est dans `IGNORABLE` (`scripts/vercel-ignore-build.mjs`) ; elle est volontairement courte. Tests : `src/lib/vercel-ignore-build.test.ts`.

## Vérifier un cas réel
Dans le journal du build Vercel, la ligne `[ignore-build] build IGNORÉ : …` ou `build EXÉCUTÉ : …` donne la raison.

## Désactiver
Supprimer la ligne `ignoreCommand` de `vercel.json` : tous les pushes redéviennent construits.

## Preuve sur Vercel réel (9 novembre 2026, PR #423)
- Commit de code (`36fb715`, `scripts/` + `src/`) : déploiement **construit** (READY).
- Commit `1320f3e` qui ne touche que `docs/` : déploiement **ignoré** (« Ignored », « 1 Skipped Deployment »).
- Statut GitHub publié par Vercel pour le build ignoré : contexte `Vercel`, état **success**, description « Canceled by Ignored Build Step ». Un check « Vercel » **requis** reste donc satisfait : une PR docs seule n'est pas bloquée.
- La CI GitHub (`verify`) tourne normalement sur ces commits.

## Limites
- Le premier push d'une branche est toujours construit : le gain porte sur les pushes suivants.
- Si Vercel changeait un jour l'état publié pour un build ignoré, une PR docs seule pourrait rester en attente du check « Vercel » : revérifier alors sur une PR de docs.
- La liste ignorable ne contient volontairement que des chemins que ni le build ni l'exécution ne lisent (vérifié par recherche dans `src/`, `prisma/`, `public/`, `scripts/`, `next.config`).
