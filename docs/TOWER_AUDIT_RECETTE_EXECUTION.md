# Protocole exécutable — Audit 100 % GameNight × The Tower

**Date : 10 novembre 2026.** Branche d'audit `docs/audit-cdc-tower-20261110`. Sources de vérité : `AGENTS.md`, `docs/CAHIER_DES_CHARGES.md`, `docs/TOWER_DECISIONS_26_20261104.md`, issue #400. Aucun déploiement, fusion, migration, changement de rôle ni publication Discord sans accord explicite.

## 1. Contrôles indépendants du dépôt

**État réel de cet audit : BLOQUÉ dans l'exécuteur de cette session** (erreur DNS `Could not resolve host: github.com`). Les 3 771 tests réussis du run GitHub Actions #419 ne sont pas une exécution locale indépendante de la version `main`.

Sur un poste/runner autorisé à accéder à GitHub, exécuter sur un checkout **jetable et propre** de `main` au SHA fixé, jamais sur un worktree d'un autre agent :

```bash
git clone --filter=blob:none https://github.com/ZeyFro/gamenight.git gamenight-audit
cd gamenight-audit
git checkout --detach 6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7
git status --short
node --version
npm ci
npx prisma generate
npx next typegen
npx tsc --noEmit
npm run lint
npm test
npm audit --omit=dev --audit-level=high
```

**Tests intégration PostgreSQL** : ne jamais fournir `DATABASE_URL` Neon/Production. Utiliser uniquement une base PostgreSQL jetable, nom strictement autorisé par `scripts/test-postgres.mjs`. Vérifier les garde-fous de ce script, les versions Node et les migrations avant de lancer les tests :

```bash
npm run test:postgres
```

Relever pour chaque commande : date UTC, SHA, exit code, total tests réussis/ignorés/échoués, durée, version Node/Postgres, erreurs et artefacts. Lancer les tests de toutes les PR candidates sur **leur SHA exact et dépendances intégrées** selon #400, sans fusion automatique.

## 2. Inventaire du vrai Discord — lecture seule

Un script **GET-only** est préparé sur la branche d'audit : [scripts/audit-discord-readonly.mjs](../scripts/audit-discord-readonly.mjs).

Il est à exécuter **uniquement** dans un environnement autorisé qui dispose **déjà** du jeton du bot et du bon `TOWER_DISCORD_GUILD_ID`, sans l'écrire dans le terminal ni dans GitHub. Il demande exclusivement :

- `GET /guilds/{id}?with_counts=true`
- `GET /guilds/{id}/roles`
- `GET /guilds/{id}/channels`

```bash
node scripts/audit-discord-readonly.mjs
```

Le résultat ne contient **ni secret, ni nom de salon, ni membre ni contenu de message**. Il donne les comptes salons/rôles/catégories/vocaux/forums et quelques observations sur les permission overwrites. **Ce n'est pas un calcul des permissions effectives des personnes** ; ne pas considérer `everyoneViewDeniedExplicitly` comme une liste certifiée de salons privés. Ne jamais joindre de capture avec secret, jeton ou identité de membre à une issue publique.

Vérifier ensuite en interface Discord, par comptes de test distincts et consentis :

| Profil | Résultat attendu | Preuve |
| --- | --- | --- |
| Nouveau membre sans rôles optionnels | Accès accueil/YAGPDB et trois forums accessibles selon politique actuelle | Capture anonymisée + clics / destination |
| Membre Minecraft | Recherche, recrutement et projets trouvables sans catégories parasites | Filtrage et liens vérifiés |
| Ami invité « Paped » | Aucun accès aux espaces d'autres groupes ; accès uniquement aux espaces autorisés | Permissions réelles vérifiées sous ce compte |
| Membre extérieur à Paped | Ne voit pas les salons/vocaux réellement privés de Paped | Vérification de visibilité ET de connexion |
| Capitaine | Gestion de son équipe, jamais accès à une autre équipe ou à la modération | Actions refusées/permises |
| Modérateur | Signalements et outils staff autorisés sans privilèges excessifs | Simulation d'actions de modération |
| Administrateur | Peut inspecter les autorisations d'accès sans effet de bord | Captures / audit droits effectifs |

**Attention :** les vocaux privés temporaires n'ont pas été démontrés livrés. Pour leur test, il faudra d'abord une implémentation validée, sans création de salon réel lors du présent audit.

## 3. Parcours complets

Sur des données et membres volontaires, après preuve du déploiement et des flags :

1. Arrivée → choix du jeu → une annonce pertinente → réponse/participation.
2. Joueur déjà en équipe → consulte son équipe et quitte/rejoint selon cooldown validé.
3. Deux membres distincts → défi solo 12 h, délai 48 h, preuve, vote 24 h/quorum, éligibilité, récompense une fois.
4. Équipe → défi collectif et attribution unique à chaque participant, simulation de conflits sans affecter vraies récompenses.
5. Notifications consenties uniquement → réception attendue ou absence de réception, aucune répétition.
6. Modérateur → signalement, limitation de contenu, rétablissement et journal adapté.
7. Équipe privée et vocal temporaire → **non disponible actuellement**, donc ne pas marquer testé avant développement/accord.
8. Validation mobile et desktop, plusieurs fuseaux horaires, comptes non-admin.

**La recette réelle doit être validée par un humain disposant des comptes/rôles autorisés.** Ni un test Discord simulé, ni un bot en lecture seule, ni une Preview READY ne suffisent.

## 4. Capacité

Tester dans une base isolée des *données synthétiques* représentant 500/2 000/10 000 comptes, des équipes et une fraction variable d'utilisateurs simultanés, en **ne générant aucun trafic artificiel abusif sur Discord**. Mesurer pagination, requêtes SQL, mémoire, durée 95e percentile, collisions transactionnelles, limiteurs distribués, saturation des 500 salons/250 rôles, API 429/Retry-After et alarmes.

## 5. Portes de clôture

- [ ] Code complet et dépendances contrôlés sur SHA fixe, résultats détaillés archivés
- [ ] Tests indépendants du dépôt et des PR pertinentes avec PostgreSQL jetable
- [ ] Liste/permissions/commandes/config du vrai serveur Discord actualisées
- [ ] Parcours réel joueur, équipe, modérateur sur desktop/mobile prouvés
- [ ] 17 critères du cahier évalués et signés, aucune absence de preuve cachée
- [ ] Nouvelles exigences privées arbitrées, implémentées et testées si incluses au lancement
- [ ] Cahier consolidé approuvé et intégré selon #400, sans écraser décisions ni propriétaires PR
- [ ] Accord explicite avant toute opération Production ou migration

**Verdict courant : NON TERMINÉ.** Ce protocole n'est pas une preuve d'exécution. Il est prêt pour l'agent/runner ayant réseau GitHub et accès Discord autorisé.
