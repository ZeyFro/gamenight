# État de reprise — 5 novembre 2026

## Reprise autonome — situation actuelle

- **Branche documentaire** : `docs/readme-migration-runner-20261105`, PR brouillon #413, empilée sur `docs/plan-migrations-20261105`. Aucun merge effectué.
- **#370**, tête `4a18b7491d1887cfc4fe38c7f1e68eb77a7571cb` : garde de chronologie et tests présents; précontrôle des doublons et créateurs orphelins. CI générale run 764 entièrement verte, Tower rules/storage run 210 vert. Preview Vercel bloquée par la limite quotidienne de déploiements. PR reste Draft.
- **#406**, tête `abeada1de5215fb2be1d16712b9574b65a92f784` : workflow ciblé run 212 vert (85 tests sur 9 fichiers), storage vert (87 tests, typegen et tsc). CI générale run 766 encore dans `npm run test:postgres`; Preview Vercel réussie. PR reste Draft.
- **Branche Neon de test** : `tower-migration-test-20261105`, ID `br-snowy-snow-b1cggq2w`, parent vérifié `br-super-cell-b1ukvk08`; état Ready, ni primaire ni par défaut. Précontrôles lecture seule : 118 migrations réussies, 0 en cours, 0 groupe de membres en doublon, 0 créateur orphelin. Aucune migration appliquée, aucune écriture ou suppression dans Neon.
- **Blocage pour lancer Prisma sur la branche de test** : cette session ne dispose ni d'un checkout du dépôt ni de `MIGRATION_DATABASE_URL` injectée dans le shell. Ne jamais transmettre l'URL ou le mot de passe dans le chat; utiliser un mécanisme d'injection sécurisé. Ne pas remplacer le runner Prisma par du SQL direct.
- **Garde-fous** : #325 reste gelée; aucune opération Production, changement de configuration, action Discord, essai réel Discord ou fusion. #407 dépend de #406 et doit être revalidée avec #396; #408 dépend de #370/#406.
- **Prochaine action exacte** : relever le résultat complet de CI générale #406 run 766 et corriger tout échec concret. Ensuite fournir un checkout local avec `MIGRATION_DATABASE_URL` injectée hors chat; confirmer l'identité de la branche de test, effectuer le dry-run exact du runner pour #370 puis #406 sans aucune autre migration, et n'exécuter que si la liste en attente est exacte et les précontrôles passent.

---

## Branche et PR en cours
- Branche courante : `docs/tower-decision-updates-20261105`.
- PR documentaire #412, brouillon, empilée sur #411 : https://github.com/ZeyFro/gamenight/pull/412.
- #412 contient les mises à jour de la roadmap, du document de décisions et cet état; le cahier canonique reste intact.
- Aucune PR n'est fusionnée.

## Fait
- PR #411 : `docs/PLAN-MIGRATIONS.md` inventorie les huit fichiers des PR #325, #370 et #406; compare SQL et schéma, décrit les objets, risques, dépendances, propositions de rollback, contrôles et questions d'autorisation. Analyse des fichiers seulement; aucune connexion ni opération de base.
- PR #407 : fenêtre de contestation alignée à 24 heures après l'annonce du résultat; constante unique `TOWER_CHALLENGE_APPEAL_WINDOW_MS`, règles, texte membre et tests unitaires/intégration mis à jour. Signalement sans quorum J+7 inchangé.
- Issue #400 : décision de 24 heures inscrite dans l'introduction et T10; commentaire de décision ajouté.
- PR #395 : abandonnée, commentée et clôturée sans fusion. Audit de #370/#396 : aucune dépendance fonctionnelle; seul chevauchement documentaire dans `.env.example`.
- Roadmap et document de décisions mis à jour pour abandonner l'exclusion des comptes de test et enregistrer le délai de contestation. Aucun changement dans `docs/CAHIER_DES_CHARGES.md`.
- PR #396 : workflow GitHub Actions préparé dans le brouillon. Deux créneaux UTC, appel limité à 09:00 Europe/Paris, idempotence de l'endpoint, trois essais maximum sur HTTP 503; URL fournie par variable et authentification par secret GitHub. Procédure d'activation documentée.
- Aucun secret/URL de production codé ou communiqué; aucun réglage GitHub Actions, Vercel ou Production modifié; aucun appel au cron, essai Discord, accès base/Neon, migration, snapshot ou fusion.

## Reste / limites
- #407 : le job `rules` passe; le job `storage` échoue car `TowerChallengeAppeal` manque dans le schéma de la branche de base, fourni par #406. Les tests d'intégration et le typage ultérieur ont donc été interrompus; aucun accès à une base réelle n'a eu lieu.
- #396 : CI en cours au dernier contrôle après publication du workflow; vérifier le résultat avant relecture.
- #412 : le check Preview est encore en attente au dernier contrôle; aucun diagnostic Vercel n'a été ouvert.
- Vérifier les checks de CI déclenchés après les derniers commits de #407, #396 et #412.
- #412 est empilée sur #411; relire les dépendances de la pile documentaire avant fusion.
- La revue de #411 doit confirmer les SQL de rollback proposés; certaines opérations pourraient perdre des données. Aucun état réel de schéma ou de `_prisma_migrations` n'est connu.
- Pour activer le workflow #396, le propriétaire devra créer le secret `CRON_SECRET` et la variable d'hôte, fusionner après revue, puis vérifier le premier déclenchement. Les schedules ne s'exécutent que depuis la branche par défaut.
- #407 garde sa dépendance de schéma envers #406 et nécessite une revalidation de compatibilité avec #396 avant toute fusion.

## Garde-fous permanents
- Aucune migration ni opération Neon/Production sans accord explicite distinct pour chaque migration.
- Aucune modification de configuration Production ou de variables d'environnement.
- Aucune modification Discord ni essai réel Discord sans autorisation.
- Aucune fusion : les PR restent en brouillon.
- Ne jamais demander ni publier un secret dans le chat.

## Prochaine action exacte
Vérifier le diff et les checks de #412, puis relire dans l'ordre la pile documentaire (#409, #410, #411, #412) et les dépendances de code avant toute décision de fusion; ne fusionner aucune PR.
