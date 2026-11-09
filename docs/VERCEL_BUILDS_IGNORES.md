# Builds Vercel ignorés (Ignored Build Step)

`vercel.json` définit `"ignoreCommand": "node scripts/vercel-ignore-build.mjs"`. Vercel exécute ce script avant chaque build : **code 0 = build ignoré, code 1 = build exécuté**. La CI GitHub (`verify`, `immutable`) n'est pas concernée.

## Règle de sûreté
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

## Limites
- Un build ignoré est annulé par Vercel. Si le check « Vercel » est **requis** dans la protection de `main`, une PR « docs seulement » peut rester en attente de ce check : vérifier la règle avant de s'y fier.
- Le premier push d'une branche est toujours construit : le gain porte sur les pushes suivants.
