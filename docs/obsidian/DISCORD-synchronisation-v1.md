# Synchronisation Discord ↔ GameNight

Principe : **une seule écriture métier par domaine**, appelée par le web et par
Discord. Aucune copie, aucun second stockage.

| Domaine | Service unique | Discorde | Web |
| --- | --- | --- | --- |
| Équipes / projets | `createCommunityTeam`, `joinCommunityTeam`, `leaveCommunityTeam`, `setCommunityTeamRecruitment` | `/equipe`, `/projet` | `/equipes` |
| Soirées | `joinSession`, `leaveSession`, `createSessionFromDiscord` (→ `createVotingSessionInTransaction`), `inviteToSession` / `revokeSessionInvite` | `/soiree`, boutons `gn:seat:*` | `/sessions`, RSVP |
| Tournois | `registerTournamentParticipant`, `unregisterTournamentParticipant` | `/tournoi`, boutons `gn:tournament:*` | `/tournois/[id]` |
| Annonces joueurs | `PlayerClassified` + `playerClassifiedSchema` / `playerClassifiedExpiresAt` | `/joueurs` | `/joueurs` |
| Profils | `discord-community-profile`, `discord-profile` | `/profil` | page profil |

Vérifications faites pendant le sprint :

- `unregisterFromTournamentAction` (web) et le bouton Discord appellent le **même**
  service ; aucune transaction dupliquée ne subsiste dans l'action.
- `/projet` ne dispose d'aucun modèle : il appelle les services d'équipe, donc un
  projet créé sur Discord est visible dans `/equipes`.
- Aucune commande n'attribue d'XP, d'étage, de point saisonnier ni de récompense :
  ces écritures restent dans les services de progression, hors commandes Discord.
- Les commandes qui écrivent restent derrière un flag propre, fermé par défaut :
  lecture ouverte n'implique jamais écriture ouverte.

Limite : la recette réelle sur le serveur Discord n'a pas été faite (accord #400
requis). Les tests couvrent les handlers, pas une interaction Discord vivante.

## Tests de synchronisation (17/11)

`src/lib/player-listings.test.ts` exerce les deux interfaces sur une base en
mémoire injectée (aucune base réelle, aucune donnée de Production) :

1. annonce créée côté Discord → visible dans la lecture web ;
2. annonce créée côté web (champs étendus #408) → visible côté Discord ;
3. retrait depuis une interface → absent des deux lectures ;
4. retrait par un autre joueur → `not_owner`, l'annonce reste ;
5. expiration identique : 24 h exactement, `expired` signalé, exclue des actives ;
6. rejeu de la même création → `duplicate`, une seule ligne en base.

Les boutons RSVP restent couverts par `discord-rsvp-interactions.test.ts` et
`test` de rejeu : un clic dupliqué ne produit jamais de seconde écriture.

Limite maintenue : le chemin **web** d'écriture ne rejoint le service qu'après
application du patch #408 ; d'ici là les tests prouvent la logique du service, pas
la bascule effective de l'action web.
