# Point de reprise unique — GameNight — 23 octobre 2026

Seul point de reprise à jour : il remplace les versions précédentes (et la section « PR ouvertes » du 22 octobre, devenue fausse). Continuer dans un worktree dédié : le checkout racine est ancien et contient des modifications locales. « Code présent » n'est jamais « validé en service ».

## Où en est le code

- **PR d'intégration : [#325](https://github.com/ZeyFro/gamenight/pull/325)**, Draft, branche `integ/xp-vocal-20261023`. Elle contient XP/boutique, vocal, build sans migration et `db-migrate`, bascule et répétitions, plus les livraisons des missions A à G. **Ne pas la fusionner** tant que les préconditions Production ci-dessous manquent : fusionner déploie du code qui suppose 6 migrations non appliquées, et le build ne migre plus.
- SHA et CI (chiffres exacts, ne pas les mélanger) : `856a881` CI verte (`test:postgres` 377/377 fichiers, 3 503/3 503 tests) ; `6b19e8d` CI **rouge** (2 fichiers, corrigés) ; **`9e841d9` CI verte** (`test:postgres` 388/388 fichiers, 3 591/3 591 tests, 678 s ; `npm test` 290 fichiers passés, 98 sautés ; build, typage, lint, Vercel). Le détail est dans la description de #325. Une tête plus récente peut exister : relire `gh pr view 325`.
- **#291, #303, #319, #324** : leurs têtes sont ancêtres de `integ/xp-vocal-20261023` (contenu intégralement présent). Elles restent ouvertes et seront **fermées après la fusion effective de #325**, avec renvoi vers elle (références croisées déjà posées en commentaire).
- Livraisons par domaine (procédures, commandes, preuves, limites) : `docs/LIVRAISON-XP.md`, `docs/LIVRAISON-BARRIERE.md`, `docs/LIVRAISON-VOCAL.md`, `docs/LIVRAISON-DISCORD.md`, `docs/LIVRAISON-PUSH-CALENDRIER.md`, `docs/LIVRAISON-TABLEAU.md` (code livré / activé / vérifié / reste exact).
- **Mission E (recettes navigateur, mobile, médias)** : branche `work/m-e-navigateur-mobile-20261023`, **non intégrée à cette date** ; ses résultats ne sont pas comptés dans les preuves ci-dessus.
- **Non expliqué** : l'intermittence du scénario « achats historiques » de `scripts/recette-boutique.mjs` (1 échec sur 2 passages complets, erreur Prisma `findUniqueOrThrow`). Le délai de 15 s des transactions boutique n'est pas une résolution. Voir `docs/LIVRAISON-XP.md` §6 pour la marche à suivre au prochain échec.

## Production (lectures seules du 23 octobre, par le coordinateur via le connecteur Neon : non reproductibles depuis le dépôt)

- Base : 111 migrations terminées sur 111, aucune inachevée ni annulée, dernière `20261020110000_tournament_team_bracket`, **aucune des 6 migrations du lot**. Identique à `main` (`c12728b`, déployé en Production avec succès le 22/10 à 19:13 UTC d'après GitHub Deployments).
- Rôles : un seul rôle de connexion applicatif, `neondb_owner` (propriétaire, création de rôles, contournement des politiques de ligne) ; rôles de plateforme `cloud_admin`, `neon_service`. **Ni rôle runtime ni rôle de migration distincts.**
- **Binding Vercel → Neon : non prouvé.** Les lectures Vercel répondent 403 : le consentement d'équipe n'a pas été accordé (un lien d'autorisation à usage unique, valable 10 minutes, se redemande à la volée). Aucune valeur de variable sensible n'est lisible ; ne rien en déduire.
- Drapeaux Production : seule la présence des noms a été établie le 22/10 (liste dans l'historique git de ce fichier) ; non revérifiée.

## Ce qui est prouvé en local, et ce qui ne l'est pas

Prouvé : répétition complète (schéma `main` → sauvegarde → barrière → 6 migrations par `db-migrate` → bascule → idempotence → échecs injectés → restauration, empreinte identique), barrière d'écriture (nouvelles connexions refusées, connexions déjà ouvertes terminées), précontrôle en lecture seule, invariants avant/après, worker vocal (arrêt propre, backoff base indisponible, bail expiré → lacune), flag vocal éteint sans les tables vocales, push/VAPID, iCal, Discord par doubles.
**Non prouvé** : tout ce qui touche Production (durée des migrations, verrous, rôles Neon, pooler, rotation de mot de passe, sauvegarde Neon restaurée, drainage des writers, crons externes), essais réels (Discord, Google/Apple, appareils, Blob), `systemd-analyze`, signaux Windows réels, image du worker. **Trou documenté** : le rôle de migration, membre de `neondb_owner`, écrit encore directement et par `SET ROLE` : ne l'utiliser que pour migrer et contrôler `--require-no-sessions-of`.

## Interventions humaines indispensables (la demande de mise en service ne peut pas être présentée avant)

1. **Accès Vercel** : approuver le consentement d'équipe pour lire déploiements et NOMS de variables.
2. **Inventaire réel de cron-job.org** (aucun connecteur) : tâches, fréquences, en-têtes ; il détermine la barrière côté crons.
3. **Hôte et accès du worker vocal** (Raspberry ou autre), fichier d'environnement privé créé localement.
4. **Choix produit** : voir les 5 questions minimales de `docs/LIVRAISON-TABLEAU.md` (aucune ne bloque).

## Demande de mise en service (à présenter une fois les préconditions établies ; ne vaut pas autorisation)

Trois autorisations **distinctes** : (A) déploiement XP (inclut les 4 migrations vocales, qui s'appliquent avec les 2 XP), (B) installation du worker, (C) activation de la collecte. Pour (A) : cible vérifiée (hôte/branche/base sans secret), SHA final de #325 vert, une fenêtre de maintenance avec barrière prouvée sur tous les writers, sauvegarde restaurée en isolation, puis **une seule** exécution de `scripts/db-migrate.mjs` avec la liste des 6 noms dans l'ordre (dry-run puis `--execute --confirm-database`), contrôles SQL (`scripts/xp-lot-invariants.mjs`), déploiement du code, réouverture ; repli par stade dans `docs/LIVRAISON-BARRIERE.md` (jamais de restauration sans perte après reprise des écritures). Durées Production inconnues.
Hors périmètre, à faire approuver avant construction : paiement intégré, catégories MVP par communauté, hors-ligne complet, Wrapped annuel.
