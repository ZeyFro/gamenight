# Annuler les prochaines occurrences d’une série

`SESSION_SERIES_CANCEL_ENABLED` est OFF par défaut. Avec ce flag actif et la migration `20261019150000_recurring_session_cancellation`, les nouvelles séries créées en une fois reçoivent un UUID commun généré côté serveur. Les anciennes séries et les créations avec flag OFF restent indépendantes; aucun rapprochement ni backfill n’est effectué.

Le créateur retrouve « Annuler la suite de la série » depuis n’importe quelle occurrence liée, y compris une occurrence passée. Le dialogue explique la portée et demande confirmation; le bouton est désactivé pendant le traitement et un refus serveur reste visible. Seuls le créateur et les contrôles d’accès existants autorisent l’action : un identifiant de groupe soumis par le navigateur n’est jamais utilisé.

La mutation vise uniquement les occurrences VOTING/SCHEDULED dont la date n’est pas passée, avec le même groupe, créateur et communauté. Les soirées passées, terminées, déjà annulées, d’un autre groupe ou serveur restent conservées. Les comparaisons emploient `wallClockNow()`.

Les lignes sont verrouillées en ordre stable. Annulations et éditions d’annonces/MP existants sont mises en file dans la même transaction; un échec d’outbox annule toute la mutation. Une seconde annulation n’écrit aucune nouvelle annonce. La fermeture éventuelle des fils intervient après commit selon les flags existants. Aucun changement des règles de notifications et aucune activation de l’isolation globale.

Ce lot ne modifie pas collectivement les dates ou cadences. Leur édition demande encore de choisir le traitement des exceptions individuelles et le comportement de replanification.

## Validation locale du 19 octobre 2026

- Nouveau champ nullable `Session.recurrenceGroupId` et index : migration strictement additive, relue indépendamment, appliquée au seul Docker `gamenight-portable1-pg`, `127.0.0.1:55440/gamenight_portable1_test` (109 migrations).
- 26 intégrations réussies, aucun ignoré, sur trois fichiers exécutés en série : lot annulation, création classique/récurrente et sondage → soirée. Les tests couvrent les doubles annulations, le rollback d’outbox, la portée du créateur/serveur/groupe, les flags ON/OFF, l’intention de création rejouée et l’isolation simulée ON. Réseau interdit dans les tests.
- 97 tests ciblés unité/action/guide/dialogue/gardes réussis sur neuf fichiers; TypeScript, lint complet et build Next direct réussis. Revue indépendante du backend, des droits, des verrous, du SQL et du dialogue sans blocage.
- Contrôle complémentaire : Prisma validate et 33 tests PostgreSQL annulation/bibliothèques/suggestions réussis sur trois fichiers en série, sans ignoré. Destination locale recontrôlée avant exécution.
- Recette navigateur authentifiée non exécutée. Aucun test ou envoi Discord réel, aucune recette distante ni activation de flag distant.
