# Analyse des 5 PR Dependabot ouvertes

Date : 21/11/2026. Analyse en lecture seule : rien n'a été fusionné, fermé, rebasé ni relancé, aucun code applicatif modifié.

Contexte : lancement public la semaine du 1er décembre 2026. Aucune fusion avant la fin de la soirée d'activation et des tests. Ordre voulu : une PR à la fois après le lancement, #501 en dernier.

Sources : les 5 PR, leurs checks et statuts (état au 21/11/2026 vers 11 h UTC), le journal du job `verify` de #501, les notes de version publiques des dépendances. Les cinq PR sont « en retard » sur `main` (base `d10fc2a`, `main` a avancé) : Dependabot devra les mettre à jour avant fusion, et les CI sont à relire sur la nouvelle tête.

## Récapitulatif

| PR | Paquet | De → vers | Type | CI | Risque | Verdict |
|---|---|---|---|---|---|---|
| #501 | `actions/checkout` | v4 → v7 | Action CI, majeure | ROUGE (`verify`) | Moyen (touche `migrate-production.yml`) + garde de test à adapter | À retarder (en dernier) |
| #502 | `actions/setup-node` | v4 → v7 | Action CI, majeure | Verte | Faible à moyen (touche `migrate-production.yml`, non exercé par la CI) | Fusionnable après tests |
| #504 | `@tailwindcss/postcss`, `tailwindcss`, `@testing-library/user-event`, `eslint-config-next` | 4.3.3 → 4.3.5 (×2), 14.6.7 → 14.6.12, 16.4.5 → 16.4.6 | npm dev, mineures/correctifs | Verte | Faible (Tailwind produit le CSS du site) | Fusionnable après tests |
| #505 | `jsdom` | 30.1.1 → 31.0.1 | npm dev (test seulement), majeure | Verte | Faible (aucun effet sur le site) | Fusionnable après tests |
| #506 | `@radix-ui/react-dialog` | 1.1.23 → 1.3.1 | npm PRODUCTION, mineure | Verte | Moyen (20 composants d'interface) | Fusionnable après tests |

Checks (tête de chaque PR) : `verify` (CI complète : tests Postgres, tests unitaires, typage, lint, build), `verify-team-command`, `rules`, `storage`, `immutable`, plus le déploiement de prévisualisation Vercel. Tout est vert sauf `verify` sur #501.

## #501 — actions/checkout 4 → 7

**Diff** : 9 fichiers, 20 lignes ajoutées, 20 retirées (le brief en annonçait 10). Tout est un remplacement de `actions/checkout@v4` par `@v7` dans `ci.yml`, `migrate-production.yml`, `migrations-immutable.yml`, `neon-test-apply.yml`, `neon-test-arbiter.yml`, `neon-test-migrations.yml`, `precheck-production.yml`, `tower-challenges.yml`, `tower-team-command.yml`. Aucune autre ligne ne change (les `ref` épinglés et `persist-credentials: false` restent).

**Pourquoi elle est rouge** (vérifié dans le journal du job `verify`) : un seul test échoue, `src/lib/neon-test-arbiter-workflow.test.ts` ligne 28 (« scelle les quatre sources et assemble uniquement les trois dossiers autorisés »). Il filtre les étapes dont `uses === "actions/checkout@v4"` puis relève leur `ref` pour vérifier les quatre commits épinglés. Avec `@v7` le filtre ne trouve rien : `expected [] to deeply equal [4 commits]`. Bilan : 1 test en échec, 6095 réussis, 1 ignoré (skipped), 629 fichiers sur 630 verts. C'est une garde de test écrite pour `@v4`, pas un défaut de l'application ni du workflow. Les quatre `ref` du workflow sont intacts dans la PR.

Conséquence : l'étape `npm run test:postgres` a échoué, donc `npm test`, `next typegen`, `tsc`, `lint` et `next build` ont été ignorés (skipped) sur cette PR. Ils ne sont pas pertinents pour un changement de workflows, mais ils ne sont pas passés non plus. Bon signe : l'étape « Run actions/checkout@v7 » du job `verify` s'est exécutée sans erreur, donc v7 fonctionne sur les runners.

**Risque** : les notes de version (checkout) :
- v5 : exécution sur Node 24 (runner minimum 2.327.1). Sans effet ici : `ubuntu-latest` hébergé par GitHub est toujours à jour.
- v6 : les identifiants (`persist-credentials`) sont écrits dans un fichier séparé sous `$RUNNER_TEMP` au lieu de `.git/config`. Sans effet ici : `migrate-production.yml`, `precheck-production.yml`, les trois `neon-test-*` et `migrations-immutable.yml` utilisent déjà `persist-credentials: false` ; aucun workflow ne fait de `git push` ni ne lance de git authentifié dans un conteneur Docker.
- v7 : refus par défaut de récupérer le code d'une PR de fork depuis `pull_request_target` ou `workflow_run` (nouvelle entrée `allow-unsafe-pr-checkout`) ; migration du code de l'action en ESM. Sans effet ici : aucun workflow n'utilise ces deux déclencheurs ; les `neon-test-*` sont en `workflow_dispatch`.
- Info utile : le journal montre déjà l'avertissement GitHub « Node.js 20 est déprécié, actions forcées en Node.js 24 » pour les actions v4. Ce n'est donc pas urgent, mais ça va devenir un bruit récurrent.
- Le changement n'est exercé par la CI que pour `ci.yml`, `migrations-immutable.yml`, `tower-challenges.yml` et `tower-team-command.yml` (déclencheur `pull_request`). `migrate-production.yml` (migrations de production, sur `main` ou à la main) et `precheck-production.yml`, `neon-test-*` (déclenchement manuel) ne sont jamais lancés par la CI de cette PR : leur passage en v7 n'est pas testé avant fusion. Le test `migrate-production-workflow.test.ts` passe, mais il ne vérifie pas la version de checkout.

**Tests** : `verify` ÉCHEC (1 test), `verify-team-command` OK, `rules` OK, `storage` OK, `immutable` OK, Vercel OK.

**Verdict : à retarder (en dernier), pas à rejeter.** La montée est saine, seule la garde de test doit suivre.

**À faire avant de pouvoir la fusionner** :
1. PR séparée (« fix(ci): garde arbiter indépendante de la version de checkout ») qui adapte `neon-test-arbiter-workflow.test.ts` : remplacer `s.uses === "actions/checkout@v4"` par un test de préfixe (`s.uses?.startsWith("actions/checkout@")` ou une expression régulière `^actions/checkout@v\d+`), en gardant l'égalité exacte des quatre `ref` épinglés. La garde de sécurité (les quatre sources scellées) reste donc entière. Fusionner cette PR d'abord.
2. Une fois la garde fusionnée, laisser Dependabot mettre #501 à jour (elle est déjà en retard) et vérifier que `verify` repasse au vert sur la nouvelle tête.
3. Relire le diff de `migrate-production.yml` : une seule ligne change (`checkout@v4` → `@v7`, `persist-credentials: false` conservé). Ne la fusionner qu'à un moment sans migration en attente, puis surveiller le prochain run réel de `migrate-production.yml` (premier passage de checkout v7 sur ce workflow). Même précaution pour `precheck-production.yml`.
4. Fusionner #501 après #502 : les deux PR modifient les mêmes fichiers sur des lignes voisines et seront à remettre à jour l'une après l'autre.

## #502 — actions/setup-node 4 → 7

**Diff** : 8 fichiers, 9 lignes ajoutées, 9 retirées : `setup-node@v4` → `@v7` dans `ci.yml`, `migrate-production.yml`, `neon-test-apply.yml`, `neon-test-arbiter.yml`, `neon-test-migrations.yml`, `precheck-production.yml`, `tower-challenges.yml` (2 fois), `tower-team-command.yml`. Les réglages (`node-version: 22`, `cache: npm`) ne changent pas.

**Risque** (notes de version setup-node) :
- v5 : Node 24 pour l'action (runner minimum 2.327.1) et cache automatique selon `packageManager`. Sans effet ici : le cache `npm` est demandé explicitement, `ubuntu-latest` est à jour.
- v6 : cache automatique limité à npm ; retrait de l'entrée `always-auth` (non utilisée ici).
- v7 : migration ESM, aucune modification d'entrées ni de sorties ; suppression du faux `NODE_AUTH_TOKEN`, sans effet car aucun workflow n'utilise `registry-url`.
- Même limite que #501 : `migrate-production.yml` et `precheck-production.yml` ne sont pas exercés par la CI de la PR.
- Production du site : aucun effet (workflows seulement).

**Tests** : `verify`, `verify-team-command`, `rules`, `storage`, `immutable` OK, Vercel OK. `verify` a donc tourné en entier (tests Postgres, unitaires, typage, lint, build) avec setup-node v7.

**Verdict : fusionnable après tests**, après le lancement. À fusionner à un moment sans migration en attente, puis surveiller le prochain run de `migrate-production.yml`.

## #504 — groupe npm « dev-minor-patch » (4 paquets)

**Diff** : 2 fichiers (`package.json`, `package-lock.json`), +194 / −421 lignes (le gros du lockfile est du nettoyage de doublons de `lightningcss`). Les quatre mises à jour :

| Paquet | De | Vers |
|---|---|---|
| `@tailwindcss/postcss` | 4.3.3 | 4.3.5 |
| `tailwindcss` | 4.3.3 | 4.3.5 |
| `@testing-library/user-event` | 14.6.7 | 14.6.12 |
| `eslint-config-next` | 16.4.5 | 16.4.6 |

**Risque** : « développement » seulement sur le papier. Tailwind sert à produire le CSS du site pendant `next build` : la version 4.3.5 peut donc changer le CSS déployé en production (correctifs : `color-mix`, variantes, performances, aucun changement cassant annoncé). `@testing-library/user-event` ne sert qu'aux tests. `eslint-config-next` passe en 16.4.6 alors que `next` reste en 16.4.5 (écart d'un correctif, sans conséquence attendue ; le lint est passé).

**Tests** : tous les checks OK (le `verify` complet inclut le build), Vercel OK. La CI ne compare pas le rendu visuel.

**Verdict : fusionnable après tests.** Après fusion et déploiement, regarder l'accueil, une fiche de soirée et une fenêtre modale sur mobile et ordinateur : la mise en page doit rester identique.

## #505 — jsdom 30.1.1 → 31.0.1

**Diff** : 2 fichiers, +109 / −296 lignes ; `package.json` change une ligne (`jsdom` dans les dépendances de développement), le reste est le lockfile (retrait de `css-tree`, `@asamuzakjp/*` et autres, ajout de `bcp-47`, `parse5-parser-stream`).

**Risque** : dépendance de test uniquement (47 fichiers de test utilisent `@vitest-environment jsdom`), aucun effet sur le code livré. Notes de version : changements cassants en v31.0.0 :
- backend canvas remplacé (`canvas` → `@napi-rs/canvas`) : sans effet, le projet n'a aucun des deux ;
- nouveau moteur CSS (analyse, sélecteurs, styles calculés) : les valeurs calculées peuvent différer légèrement ;
- l'analyse HTML attend désormais les scripts bloquants ; l'événement `load` ne part plus que sur la fenêtre ; focus et `tabIndex` corrigés.
Version minimale de Node : `^22.22.2 || ^24.15.0 || >=26` (identique à jsdom 30.1.1 d'après le lockfile) ; la CI utilise `node-version: 22`, qui prend la dernière 22.x. En local, avoir Node 22.22.2 ou plus.

**Tests** : tous les checks OK ; `verify` a exécuté les 47 fichiers jsdom sans échec, ce qui est le test le plus parlant pour cette PR. Vercel OK.

**Verdict : fusionnable après tests.** Risque limité aux tests ; si un test devenait instable plus tard, le retour arrière est une simple annulation de la fusion.

## #506 — @radix-ui/react-dialog 1.1.23 → 1.3.1

**Diff** : 2 fichiers, +59 / −56 lignes ; `package.json` change une ligne ; le lockfile monte aussi une dizaine de dépendances internes de Radix (`primitive`, `context`, `dismissable-layer`, `focus-guards`, `focus-scope`, `portal`, `presence`, `react-primitive` 2.1.10 → 2.2.0, `slot` 1.3.3 → 1.5.0, `use-controllable-state`, `use-callback-ref`).

**Risque** : dépendance de PRODUCTION, utilisée dans 20 composants (`import * as Dialog from "@radix-ui/react-dialog"`) : barre latérale et tiroir mobile (`app/Sidebar`), cloche de notifications, chat, fenêtres de suppression/annulation/modification de soirée, de tournoi et de jeu, tirage de jeu de la soirée, filtres de jeux et de potes (tiroirs), calendrier (`DayTimeline`, `SessionBlock`, `PoteFilterDrawer`), invitation d'onboarding, formulaires d'administration (`XpAdjustForm`, `ForceReloginCard`), `VoterAvatars`, `EndInstantSessionDialog`, `WithdrawProposalDialog`. Notes de version : 1.2.0 corrige les couches imbriquées dans une modale (focus et défilement) et accepte plusieurs `aria-describedby` ; 1.3.0 assouplit les types (`exactOptionalPropertyTypes`) ; 1.3.1 corrige une régression de types. Aucun changement cassant annoncé, mais le comportement du focus et du défilement dans les modales a bougé.

**Tests** : tous les checks OK (typage et build inclus), Vercel OK. Aucun test n'importe Radix directement ; une partie des composants concernés est rendue dans des tests jsdom (Sidebar, NotificationBell, ChatPanel, DayTimeline, etc.), mais 7 d'entre eux n'ont aucun test (par exemple `EditSessionDialog`, `DeleteSessionDialog`, `CancelTournamentDialog`, `VoterAvatars`). Le comportement réel (ouverture, fermeture, touche Échap, clic extérieur, défilement bloqué, focus) n'est donc pas couvert de bout en bout.

**Verdict : fusionnable après tests**, avec un contrôle manuel obligatoire après déploiement sur ordinateur ET mobile : ouvrir et fermer le tiroir de navigation, la cloche de notifications, le chat, une fenêtre de confirmation (suppression de soirée), un tiroir de filtres ; vérifier Échap, clic à côté, défilement de la page derrière, et un menu déroulant ouvert dans une modale.

## Ordre de traitement après le lancement

Une PR à la fois, jamais deux fusions à la suite sans contrôle intermédiaire. Après chaque fusion, les PR restantes sont mises à jour par Dependabot (le lockfile est commun à #504, #505 et #506, les workflows à #501 et #502) : attendre la CI verte sur la nouvelle tête avant de continuer.

1. #504 (groupe dev, faible risque ; contrôle du CSS).
2. #505 (jsdom, tests seulement).
3. #506 (Radix Dialog, la seule vraie PR « production » : prendre le temps du contrôle manuel).
4. #502 (setup-node 7), un moment sans migration en attente, puis surveiller le prochain run de `migrate-production.yml`.
5. PR séparée qui adapte la garde `neon-test-arbiter-workflow.test.ts` (version de checkout non figée, `ref` épinglés conservés).
6. #501 (checkout 7), en dernier, après relecture du diff de `migrate-production.yml` et CI `verify` verte.

Ne fusionner aucune de ces PR avant la fin de la soirée d'activation et des tests, ni la veille d'une activation de migration.

## Procédure de fusion d'une PR Dependabot

Étapes simples, une PR à la fois (la fusion sur `main` redéploie la production) :

1. Ouvre la PR et vérifie en bas que tous les contrôles sont verts (`verify`, `verify-team-command`, `rules`, `storage`, `immutable`, `Vercel`) et que la CI date de la dernière version de la PR. Si la PR indique qu'elle est en retard sur `main`, attends que Dependabot la remette à jour et que la CI repasse au vert. Un contrôle rouge ou orange : on ne fusionne pas.
2. Lis le changelog (dans la description de la PR, rubrique « Release notes ») : cherche « breaking », « removed », « requires Node ». Rien d'alarmant ? Continue. Un doute ? Ne fusionne pas et demande.
3. Vérifie qu'aucune migration de base n'est en attente et que personne n'est en train de déployer autre chose.
4. Fusionne (bouton « Merge pull request », fusion classique, pas de suppression de branche nécessaire).
5. Attends la fin du déploiement Vercel (statut vert « Ready » sur le dernier déploiement de production dans Vercel) avant toute autre action.
6. Contrôle rapide du site : accueil, connexion, une page de soirée, ouvrir une fenêtre modale et le tiroir de navigation sur mobile ; regarde aussi que le journal d'erreurs Vercel reste calme quelques minutes.
7. Tout va bien : passe à la PR suivante. Un problème : retour arrière (annulation de la fusion et redéploiement de la version précédente) en suivant `docs/RUNBOOK.md` (document ajouté par une autre PR).

Règle d'or : un seul changement à la fois, pour savoir lequel est en cause en cas de souci.
