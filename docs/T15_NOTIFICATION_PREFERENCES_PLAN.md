# T15 — préférences personnelles de notification : plan vérifié

Audit en lecture du code le 4 novembre 2026. Aucun paramétrage, déploiement,
envoi Discord ni changement de schéma effectué. Ce plan complète
`TOWER_NOTIFICATION_PREFERENCES_GAPS.md` ; le texte intégral du §24 n'est pas
présent dans les fichiers consultés, sa conformité complète reste à confirmer.

## Existant constaté

| Élément | Preuve et limite |
| --- | --- |
| Choix individuel | `src/lib/notification-preferences.ts` : SESSION, ROULETTE, TOURNAMENT, INSTANT_SESSION ; ligne explicite prioritaire, repli `!silenceReminders`, SESSION synchronise le champ historique |
| Persistance | `UserNotificationPreference` dans `prisma/schema.prisma` : clé `(userId, category)`, un booléen, aucun canal ni horaire |
| Écran et écriture | `src/app/profil/parametres/page.tsx` et `src/app/profil/actions.ts` : quatre boutons, identité de session uniquement, validation et limitation de fréquence de l'action ; pas d'API REST distincte nécessaire |
| Consentement à la livraison | `session-announce.ts`, `tournament-announce.ts`, `roulette-dm.ts`, `instant-session-announce.ts` relisent les préférences dans les chemins personnels ; l'executor délègue cette responsabilité aux résolveurs |
| Centre interne et push | `src/lib/notifications.ts` écrit les notifications puis appelle `sendUserWebPush` ; pas de politique globale de catégorie/canal dans ces fonctions ; certains appelants filtrent déjà en amont |
| Push par appareil | `src/lib/web-push-delivery.ts` exige configuration et abonnement ; pas de choix par événement, créneau ou plafond |
| Tower | `tower-challenge-announcements.ts` émet uniquement `TOWER_PROOF_SUBMITTED` et `TOWER_CHALLENGE_APPROVED`, catégorie technique ACHIEVEMENT, vers un salon, mentions interdites. Le consentement de publication du succès est vérifié séparément. Aucun MP personnel Tower ni type NotificationType Tower dédié constaté |

Les booléens actuels ne permettent pas de choisir « conserver dans GameNight,
couper les MP, conserver le push ». Une désactivation en amont peut également
supprimer la notification interne correspondante. Il faut définir la politique
avant d'ajouter des boutons promettant une indépendance inexistante.

## Manques et limites du périmètre

- Séparation in-app, Web Push, MP Discord et mention nominative dans un salon.
  Une annonce communautaire sans mention ne relève pas d'un opt-out individuel.
- Préférences Tower distinctes : non implémentées. Aucun événement de contestation,
  résultat de vote ou rappel saisonnier personnel existant à exposer artificiellement.
- Horaires de silence, fréquence maximale et regroupement d'envoi : non constatés.
  `groupNotifications` regroupe seulement l'affichage des superlatifs d'une soirée.
- Priorité sécurité/service : aucune classification centrale constatée. Une catégorie
  technique ADMIN n'est pas une justification suffisante pour contourner un refus.
- Recette réelle multi-appareil, MP fermé et isolation communautaire : non effectuée
  dans cet audit. Les tests existants ne prouvent pas la configuration en production.

## Mise en œuvre minimale proposée, sans dépendance

1. Inventorier les producteurs existants et définir une table explicite
   événement → catégorie personnelle → canal → politique de service. Garder les
   quatre catégories fonctionnelles et n'exposer une nouvelle famille que lorsque
   tous ses producteurs et chemins de reprise appliquent la politique.
2. Ajouter une table additive `UserNotificationChannelPreference`, avec clé
   `(userId, category, channel)` et booléen `enabled`. Employer une liste fermée
   de canaux comprenant IN_APP, WEB_PUSH, DISCORD_DM, DISCORD_MENTION ;
   `DeliveryChannel` ne distingue pas mention/annonce et ne contient pas le push.
   Conserver `UserNotificationPreference` et son contrat pendant la transition.
   Absence de nouveau réglage : reproduire exactement l'ancien comportement,
   jamais réactiver un canal supprimé par le réglage historique.
3. Introduire `src/lib/notification-channel-preferences.ts` : validation fermée,
   lecture groupée, résolveur pur de politique et écriture pour l'identité de
   session. Ne pas importer la politique dans le moteur Discord générique au
   prix d'une déduction fragile depuis `recipientKey` ; chaque résolveur connaît
   ses vrais destinataires. Relire le choix au SEND et au fallback de mention.
4. Extraire un formulaire autonome `src/components/NotificationChannelPreferences.tsx`
   et une action dédiée `src/app/profil/notification-channel-actions.ts` ;
   raccorder au profil après levée des réservations. Afficher seulement les
   combinaisons réellement couvertes. Un MP fermé ne doit jamais provoquer une
   mention de secours refusée, et ne doit pas supprimer l'événement métier.
5. Appliquer la politique in-app/push dans `notifications.ts`, puis traiter les
   écritures directes, notamment `reward-notifications.ts`. Attention : filtrer
   seulement le helper laisse passer ces écritures ; filtrer seulement le push
   ne recrée pas les notifications déjà supprimées en amont. Séparer la décision
   métier de la décision de distribution, préserver l'idempotence.
6. Dans une phase distincte, ajouter les producteurs personnels Tower lorsque
   leurs lots métier sont intégrés. Aucun nouveau ping, MP ou événement Tower
   n'est activé par ce plan. Le consentement de publication reste indépendant.

Le statut « service » proposé concerne d'abord la conservation d'une décision
dans l'application ; il ne force ni push, ni MP, ni mention. Aucun événement de
sécurité existant ne doit être présumé. Définir sa liste exhaustive avant toute
exception au consentement. Les horaires/plafonds/digests sont une phase suivante,
avec persistance nécessaire ; ne pas les présenter comme couverts par le premier lot.

## Fichiers et réservations vérifiés sur GitHub

| Intervention | Collision actuelle |
| --- | --- |
| `prisma/schema.prisma` + nouvelle migration | Schéma réservé par #370 ; attendre intégration ou coordination explicite |
| `notification-preferences.ts`, `notifications.ts`, `web-push-delivery.ts`, nouveaux helper/action/composant/tests | Pas dans les listes de fichiers modifiés des #370, #384, #385, #387, #388, #392, #394, #395, #396, #397 consultées |
| `session-announce.ts`, `tournament-announce.ts`, `roulette-dm.ts`, `instant-session-announce.ts`, `discord-dm.ts`, `reward-notifications.ts` | Pas dans ces listes ; auditer tous les SEND, EDIT et secours avant changement |
| `profil/parametres/page.tsx`, `profil/actions.ts` | Pas dans ces listes ; préférer nouvelle action pour limiter le couplage |
| `tower-challenges.ts`, son test d'intégration | Réservés #395 et #397 ; aucun raccord producteur maintenant |
| `discord-tower-*`, `discord-interactions.ts`, panneau onboarding | Réservés Claude #385/#388 ; inutile de les modifier pour les préférences |
| `.env.example`, `CLAUDE.md`, `docs/CRONS.md` | Réservés #370/#388/#396 ; aucune nouvelle variable ni cadence requise pour le premier lot |

Les réservations doivent être relues au démarrage du code : cette vérification
porte sur les listes GitHub du jour, pas sur les changements non publiés d'autres sessions.

## Tests pertinents et portes de livraison

- Unitaire : choix par canal, repli conservateur, catégories/canaux invalides,
  aucun utilisateur réintroduit par un filtre, séparation publication/notification.
- Action : non authentifié, tentative d'userId tiers ignorée, limitation,
  erreur base et formulaire invalide ; affichage accessible de l'état enregistré.
- Résolveurs : désactivation entre enqueue et exécution, deux joueurs opposés,
  MP fermé sans mention refusée, édition technique sans nouveau ping,
  aucun envoi en Preview ; le résultat métier reste intact si notification refusée.
- Postgres isolé : unicité, persistance et concurrence, rollback, lecture par un
  second client, idempotence sans recréer un événement déjà traité, isolation de
  communauté. Couvrir aussi les producteurs écrivant directement Notification.
- Mutation : court-circuiter le filtre d'un canal doit faire échouer son test.
- Livraison : nouvelle PR brouillon seulement si moins de dix PR code ouvertes ;
  migration additive identifiée en tête, snapshot Neon frais et application en
  production avant merge selon la procédure autorisée. Ce plan n'autorise aucune
  exécution SQL de production. Un seul push groupé lorsque le lot est complet.
- Recette effective uniquement dans l'environnement isolé autorisé, données fictives,
  sorties Discord bloquées matériellement jusqu'au test explicitement autorisé.

Tests lus, non relancés pendant cet audit : `notification-preferences.test.ts`,
`notification-preferences.integration.test.ts`,
`src/app/profil/notification-preference-actions.test.ts`, tests des résolveurs et
`reward-notifications.integration.test.ts`. Aucun résultat de test nouveau revendiqué.
