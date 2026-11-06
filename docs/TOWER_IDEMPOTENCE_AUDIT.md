# Audit d'idempotence — GameNight / Discord (lot 14)

## Résultats de la lecture du code

| Chemin | Protection | État |
| --- | --- | --- |
| RSVP tournoi | `src/lib/tournament-registration.ts` : verrou `SELECT ... FOR UPDATE` sur `Tournament`, test du nombre d'inscrits et du membre existant, insertion unique protégée | **VÉRIFIÉ dans le code**, test de rejeu/concurrence à revoir |
| RSVP instantané | `src/lib/discord-instant-session-rsvp.ts` : `NotificationEvent` avec `occurrence=interactionId`, conflit unique et réponse « déjà prise en compte ». En cas d'échec métier, reçu supprimé pour permettre une relance | **VÉRIFIÉ dans le code**, attention au risque entre reçu et mutation métier |
| Événement de notification | `prisma/schema.prisma:2602` : `@@unique([category,eventType,sourceId,occurrence])`. `src/lib/notification-delivery.ts` utilise `createManyAndReturn(...skipDuplicates)` puis relit | **VÉRIFIÉ**, index unique déjà déclaré |
| Envoi Discord physique | Documentation `src/lib/notification-delivery.ts` : pas de garantie « exactement une fois » lorsque Discord accepte la requête mais que la confirmation SQL échoue | **Risque résiduel documenté**, pas une panne démontrée |

## Risque résiduel à tester avant lancement

- Deux réponses RSVP de tournoi simultanées pour le même utilisateur : une inscription, un seul incrément des compteurs et aucun dépassement `maxPlayers`.
- Rejeu du même `interactionId` instantané : aucune deuxième mutation.
- Cas d'interruption **après le reçu** mais avant la mutation instantanée : le reçu peut rester présent si le processus est interrompu sans exception. Ce n'est pas un double traitement mais une opération potentiellement bloquée ; envisager un reçu transactionnel ou une reprise contrôlée en PR métier.
- Un événement `NotificationEvent` unique n'empêche pas à lui seul un double envoi physique quand l'accusé de réception Discord est perdu.

## Décision

**Ne pas ajouter d'index sur `NotificationEvent` : la clé unique demandée existe déjà.** N'appliquer aucune migration de prod. Les scénarios doivent s'exécuter avec une base Postgres de test isolée ; aucune annonce sur The Tower durant la recette.
