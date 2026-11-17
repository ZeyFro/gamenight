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
