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

## Politique de livraison du lot 5 (Q17 à Q19, D09, D10)

Chaque type d'événement de la file porte un **genre explicite** (`src/lib/notification-kinds.ts`, liste fermée) et l'executor évalue `evaluateDeliveryPolicy` **avant** de résoudre le contenu et d'appeler Discord. Un refus est terminal (`FAILED`, `errorClass` `policy:<motif>`, `lastError` lisible) et journalisé (`notification-policy`). Aucun refus n'est silencieux.

| Genre | Canaux autorisés | Exemples |
| --- | --- | --- |
| `PERSONAL_DM` | MP, dans l'app | `SESSION_DM`, `TOURNAMENT_DM`, `ROULETTE_DM`, `INSTANT_SESSION_INVITE`, `TEAM_APPLICATION_NOTIFY`, `TOURNAMENT_TEAM_NOTIFY`, `ONBOARDING_REMINDER`, `TOWER_AUTO_VALIDATED` |
| `PUBLIC_MILESTONE` | salon, dans l'app | liste fermée ci-dessous |
| `PUBLIC_UPDATE` | salon (édition ou retrait d'un message déjà autorisé) | `SESSION_MODIFIED`, `SESSION_REMOVED`, `TOURNAMENT_MODIFIED`, `TOURNAMENT_REMOVED`, `TOWER_PROOF_VOTE_UPDATED` |
| `THREAD_CONTEXT` | salon (fil d'une annonce déjà autorisée, mention de secours) | `SESSION_REMINDER`, `SESSION_DATE_CHANGED`, `TOURNAMENT_MATCH_RESULT`, `*_DM_FALLBACK`, `TOWER_PROOF_THREAD` |
| `OPT_IN_ROLE_PING` | salon, dans l'app | aucun type aujourd'hui (voir ping de rôle) |
| `IN_APP_ONLY` | dans l'app seulement | aucun type aujourd'hui (le genre refuse tout canal Discord pour un futur événement purement in-app) |
| `SYSTEM_ACTION` | salon (action de l'executor, ce n'est pas une notification) | synchronisation d'espaces, rôles, signalement, soutiens |

**Moments marquants (annonce publique, liste fermée `PUBLIC_MILESTONE_EVENT_TYPES`)** : soirée annoncée (`SESSION_CREATED`), soirée validée (`SESSION_VALIDATED`), résultat de soirée (`SESSION_RESULT`), tournoi créé (`TOURNAMENT_CREATED`), résultat de tournoi (`TOURNAMENT_RESULT`), preuve et réussite d'un défi Tower avec consentement (`TOWER_PROOF_SUBMITTED`, `TOWER_CHALLENGE_APPROVED`, `TOWER_CHALLENGE_REJECTED`, `TOWER_AUTO_VALIDATION`), annonce communautaire : trophée de groupe, récompense, fin de saison, jeu gratuit (`COMMUNITY_SYSTEM_ANNOUNCE`). **Tout autre événement** devient un MP personnel, un message dans le fil d'une annonce autorisée, ou une notification dans l'app.

**Échec fermé** : un type d'événement non classé est refusé sur tous les canaux. Le test `notification-kinds.test.ts` lit le code et échoue si un `eventType` créé n'est pas classé ; un nouvel événement doit donc être classé (avec son canal) avant d'envoyer quoi que ce soit.

**Ping de rôle de jeu (Q19, D09)** : `discord-rest.ts` retire TOUTE mention de rôle (`roles` et `parse: ["roles"]`) qui n'est pas l'objet produit par `buildGameRolePing` (jeu avec au moins un abonné opt-in, un seul rôle non sensible, identité de l'objet vérifiée par un `WeakSet`). Jamais @everyone/@here. Un appelant ne peut donc pas ajouter un ping de rôle par oubli.

## Décisions prises seules (lot 5, à valider par Maxime)

1. **« Jouer maintenant » garde son annonce publique, sans mention** (corrigé avant fusion) : une partie immédiate est une soirée ouverte aux membres, annoncée comme une soirée (`INSTANT_SESSION_ANNOUNCE` = moment marquant, sa mise à jour = édition) ; le sous-agent l'avait supprimée par prudence, ce qui aurait retiré en silence un comportement déjà en production (`instant-announcement.integration.test.ts`). L'invitation reste un MP, jamais pré-cochée (#552).
2. **La soirée annoncée et le tournoi créé restent des moments marquants** (ils portent le fil et les MP de la décision #116) ; un rappel, un changement de date, un résultat de match ou une mention de secours restent dans le fil de l'annonce, jamais dans un salon libre.
3. **Aucun ping de rôle de jeu n'est branché** dans une annonce : le garde-fou est posé, mais aucun appelant n'en demande (option la plus restrictive). À brancher seulement sur demande (tournoi public, jeu gratuit).
4. **Deux genres techniques** s'ajoutent aux quatre de la demande : `THREAD_CONTEXT`/`PUBLIC_UPDATE` (suite d'un message déjà autorisé) et `SYSTEM_ACTION` (actions d'administration de l'executor), pour ne pas casser les fils, les éditions et les espaces existants.

## Limites
- `buildGameRolePing` et `notifyGamePingOptIns` sont prêts pour un contexte public (tournoi public, jeux gratuits) mais aucun appelant n'est branché (décision 3 ci-dessus).
- Les chemins MP existants (soirée, tournoi, roulette, Jouer maintenant) ne sont pas réécrits : la politique les encadre au point de passage unique de l'executor, elle ne change pas leur contenu.
