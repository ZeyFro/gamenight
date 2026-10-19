# Abonnement iCal privé

## Parcours

Avec `CALENDAR_SUBSCRIPTIONS_ENABLED=true` (OFF par défaut), `/calendrier` propose de créer ou renouveler un lien privé pour le serveur courant. Coller ce lien dans « Ajouter par URL » / « Nouvel abonnement » de l’application calendrier. Il n’est affiché qu’après sa création; un renouvellement invalide l’ancien lien de ce serveur. La révocation est idempotente et ne touche pas les liens des autres serveurs.

Le téléchargement ponctuel `/api/calendrier/export` reste disponible. Le flux continu reprend le même générateur ICS, ses UID stables et les dates Europe/Paris. Il affiche uniquement les soirées futures VOTING/SCHEDULED auxquelles le propriétaire a accès comme créateur ou invité actif. Il reste lié au serveur capturé même si l’utilisateur change de serveur dans GameNight.

## Accès et données

- Migration additive `20261019140000_calendar_feed_tokens` : nouvelle table, index et clés étrangères; aucune transformation des données existantes.
- Jeton opaque de 32 octets aléatoires, encodé base64url. Seul son hash SHA-256 est conservé en base, avec propriétaire, communauté, date et révocation. Aucun secret d’environnement supplémentaire.
- Chaque lecture revalide l’appartenance ACTIVE du propriétaire et le statut ACTIVE du serveur, puis utilise le client scopé et le contrôle d’accès personnel existant. Les soirées historiques sans `communityId` sont admises uniquement pour `default`. Ce périmètre explicite fonctionne aussi avec l’isolation globale éteinte; aucun flag d’isolation n’est activé.
- Le lien donne un accès en lecture à son détenteur : ne pas le partager, le journaliser dans l’application ou le copier dans une PR. Réponses `private, no-store`, `no-referrer` et 404 identique pour un lien invalide, révoqué ou inaccessible.
- Rotation/révocation prennent effet pour les prochaines requêtes. Un calendrier tiers peut conserver son cache et choisit sa fréquence de rafraîchissement. Un traitement déjà engagé peut terminer sa lecture.

## Validation du 19 octobre 2026

- PostgreSQL Docker dédié `gamenight-portable1-pg`, `127.0.0.1:55440/gamenight_portable1_test`, destination vérifiée avant écritures. La migration est appliquée localement (108 migrations au total).
- Intégration iCal : 3 scénarios réussis, aucun ignoré. Rotation/révocation, serveur capturé, soirées historiques, confidentialité des invitations, appartenance retirée et communauté suspendue sont couverts avec isolation OFF. Réseau interdit dans les tests.
- Unités, route/actions/pages, export existant, guide et gardes de scope/exports serveur : 92 tests réussis sur 10 fichiers. Revue indépendante du frontend, des droits, du backend et du SQL sans blocage relevé.
- `prisma validate`, génération Prisma, `next typegen`, `tsc --noEmit`, lint et build Next direct réussis localement. Le build utilise la DB Docker locale et garde les flags d’abonnement, d’isolation et d’executor éteints.
- Les premiers runs ont corrigé des fixtures : client Neon remplacé par Prisma TCP local, import `afterEach`, dates de soirée basées sur `wallClockNow()` et statut d’invitation `REVOKED`.
- Abonnement réel dans Google/Apple Calendar et parcours navigateur authentifié non exécutés. Aucune écriture de recette distante, aucun envoi Discord, aucune activation de flag distant.
