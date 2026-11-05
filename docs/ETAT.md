# État de reprise — 5 novembre 2026

## Branche et PR en cours
- Branche courante : `docs/tower-decision-updates-20261105`.
- PR documentaire #412, brouillon, empilée sur #411 : https://github.com/ZeyFro/gamenight/pull/412.
- #412 contient les mises à jour de la roadmap, du document de décisions et cet état; le cahier canonique reste intact.
- Aucune PR n'est fusionnée.

## Fait
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
