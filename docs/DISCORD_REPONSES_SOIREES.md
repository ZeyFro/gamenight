# Répondre à une soirée depuis Discord

Ce lot prolonge les places et la liste d'attente de #208. Il ne crée pas une
deuxième inscription : site et Discord appellent `changeSessionSeat`.

## Parcours livré

- Une soirée SCHEDULED, future, avec une capacité activée propose « Je viens »
  et « Je viens pas » sur l'annonce du fil privé, les rappels et les MP.
  Cela comprend une soirée planifiée issue d'une roulette.
- « Je viens » confirme une place libre ou inscrit en attente ; « Je viens pas »
  libère la place et promeut le premier invité encore autorisé.
- Discord acquitte le clic avant toute lecture SQL et présente ensuite une
  confirmation éphémère. Le message collectif n'est pas remplacé par la réponse
  d'un seul joueur. Le site est invalidé et l'annonce/les invitations déjà
  envoyées sont éditées via l'executor existant, sans nouveau ping de réponse.
- Les boutons ne sont pas proposés pendant le vote du jeu, sans capacité ou
  après le début. L'édition de l'annonce et du MP d'invitation les retire à la
  fin/annulation. Les anciens rappels peuvent conserver des boutons visibles :
  le clic revalide la date et le statut, et refuse toute inscription fermée.

## Messages et pings

La création déjà SCHEDULED utilise désormais le modèle actif SESSION_CREATED
dans le fil et en MP, comme la création VOTING. Une mise à jour du fil VOTING
conserve également un texte personnalisé. Les textes de rappel personnalisés
et les modèles de changement de date restent utilisés.

Le créateur est exclu des mentions normales dans tous les états. Il garde les
MP selon ses préférences et la mention de secours lorsqu'un MP échoue. Les
invités éligibles restent mentionnés dans le fil et reçoivent les MP activés.
Les soirées issues d'une roulette ne mentionnent personne. Une inscription ou
un désistement édite l'annonce ; il ne déclenche pas un nouveau MP ou ping.

Les modèles `MessageTemplate` restent le catalogue partagé existant ; cette
PR n'ajoute pas de modèles personnalisés propres à chaque serveur.

## Contrôles serveur et reprise

Signature Ed25519 sur le corps brut, application Discord attendue, horodatage
de moins de 5 minutes, identité de l'auteur du clic (`member.user` en serveur,
`user` en MP). Aucun id utilisateur n'est accepté dans le bouton.

Dans la transaction verrouillée : accès privé à la soirée, Community ACTIVE,
Membership ACTIVE et identité Discord revalidés ; serveur du clic identique
à celui de la soirée ; message/canal correspondant à une livraison BOT/SEND
SENT persistée pour cette soirée. En MP, le destinataire doit être l'auteur du
clic. Ces contrôles Discord restent présents même si l'isolation est éteinte.
Le serveur sélectionné sur le site n'est ni modifié ni utilisé comme droit.

Un reçu SESSION_RSVP avec l'id de l'interaction est persisté dans
NotificationEvent, dans le même commit que le siège, la notification de
promotion et la mise en file d'édition. Un retry ne rejoue pas une ancienne
réponse après un autre geste. Aucun token d'interaction n'est stocké.
Après erreur ou perte de la confirmation Discord, consulter l'inscription sur
le site avant de recommencer. La limitation de débit est par instance, comme
les actions existantes ; l'idempotence métier est persistée en Postgres.

## Configuration existante

Pas de nouvelle migration, dépendance, commande slash ou flag.
`DISCORD_CLIENT_ID` et `DISCORD_APP_PUBLIC_KEY` doivent correspondre à
l'application du bot. L'Interactions Endpoint URL est celle déjà utilisée
par `/gamenight setup` :
`https://gamenight-zeyfro.vercel.app/api/discord/interactions`.
Le flag de setup ne gouverne pas les réponses aux boutons.

Les annonces/éditions exigent toujours l'executor et son cron, les salons
configurés, les permissions Discord et les flags bot/MP déjà en service.
Aucune configuration distante n'est modifiée par cette PR. Les anciens messages
ne gagnent des boutons qu'après une édition (par exemple activation de capacité).

## Validation réelle après merge et déploiement Ready

1. Sur The Tower, créer une soirée future avec un jeu choisi et deux invités.
   Dans la page de soirée, activer **2 places**, avant de dépasser ce nombre de
   votants historiques (ils sont préservés). Attendre le passage du cron pour
   l'édition de l'annonce. Vérifier le texte personnalisé et les deux boutons
   dans le fil privé ; vérifier les MP si les destinataires les autorisent.
2. Avec les deux invités, répondre depuis Discord : un « Je viens » prend la
   dernière place, l'autre met en attente. Rafraîchir la soirée sur le site :
   mêmes statuts et aucun doublon malgré deux clics.
3. Le joueur confirmé clique « Je viens pas » : le suivant est promu sur le site
   et reçoit sa notification in-app. La réponse Discord est privée ; aucune
   nouvelle annonce avec ping général n'est envoyée.
4. Sélectionner l'autre communauté sur le site puis répondre à l'invitation
   The Tower : seule la soirée The Tower change. Retirer un invité via le site
   et vérifier qu'un ancien bouton ne lui permet plus de participer.
5. Terminer/annuler cette soirée de test : l'invitation éditée perd ses boutons,
   et un ancien rappel refuse les nouvelles inscriptions. Refaire seulement le
   parcours nominal sur le serveur historique pour contrôler le routage.

Ces gestes réels ne sont pas exécutés par les tests automatiques. Ceux-ci
utilisent des signatures/données simulées, des réponses HTTP mockées et le
Postgres isolé de CI, jamais Neon ni de vrais messages Discord.

## Limites du lot

Pas de RSVP tournoi/session instantanée, ni d'inscription sans capacité.
Pas de nouveau MP de promotion : la notification de promotion reste in-app.
La livraison des éditions attend l'executor ; elle n'est pas instantanée.
L'écran Discord et les permissions réelles restent à valider par le mainteneur.
