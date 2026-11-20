# Centre de notifications (sujet I)

Flag : `NOTIFICATION_CENTER_ENABLED` (OFF par défaut, exactement `true`). Migration `20261118130800_notification_center` (APRÈS #416).

## Règles (décision de Maxime, 18/11/2026)
- MP Discord uniquement pour ce qui vise personnellement le joueur : invitation, candidature, son défi, contestation (`isDirectMessageAllowed`, `src/lib/notification-policy.ts`).
- Le reste : centre de notifications `/notifications` + Web Push existant (#406 : préférences par catégorie et canal inchangées) + ping de rôle de jeu opt-in dans un salon.
- Jamais @everyone/@here : `parse=everyone` est retiré dans `discord-rest.ts` pour tous les appelants, flag OFF compris.
- Annonces publiques réservées aux moments marquants (nouveau Ranker/High Ranker, victoire de tournoi, record) : `isPublicAnnouncementAllowed`.

## Contenu
- `/notifications` : liste, filtre non lues, lecture individuelle, « tout marquer lu », opt-in par jeu (table `GamePingOptIn`, scopée communauté, 50 jeux max).
- `notifyGamePingOptIns` : notification in-app aux seuls abonnés ; `buildGameRolePing` : mention d'un seul rôle non sensible, seulement si au moins un abonné.

## Limites
- Le ping de rôle n'est PAS branché dans les fils de soirée (soirées privées sur invitation : un rôle pingerait des non-invités). `buildGameRolePing` et `notifyGamePingOptIns` sont prêts pour les contextes publics (tournoi public, jeux gratuits) à brancher par un lot suivant.
- Les chemins MP existants (soirée, tournoi, roulette, Jouer maintenant) ne sont pas modifiés : la règle est documentée et testée comme politique, pas réécrite à l'aveugle.
