# Tournois par équipes inscrites

Interrupteur : `TOURNAMENT_TEAMS_ENABLED` (OFF par défaut, valeur exacte `true`). Migration additive `20261118130400_tournament_teams` : trois nouvelles tables
(`TournamentTeamSettings`, `TournamentTeamEntry`, `TournamentMatchReport`) et une enum ; **aucune colonne ajoutée à `Tournament`** (une ligne `TournamentTeamSettings`
marque un tournoi d'équipes), donc aucune lecture existante ne dépend de la migration. Prérequis : `communityTeamsEnabled`. MP : aussi `NOTIFICATION_EXECUTOR_ENABLED` et le jeton du bot.

## Fonctionnement (`/tournois/equipes`)
- Tout membre actif organise un tournoi : un jeu, 2 à 8 équipes, **public** (le capitaine inscrit son équipe) ou **privé** (sur invitation de l'organisateur, visible seulement de
  l'organisateur et des membres des équipes invitées/inscrites ; absent des listes, de l'accueil et des commandes Discord), échéance d'inscription facultative.
- Inscription par le **capitaine** (capitaine actif, sinon membre actif le plus ancien). La dernière place prise lance le tournoi ; l'organisateur peut lancer avant (au moins 2 équipes) ;
  à l'échéance, le cron lance avec les équipes inscrites (au moins 2). Lancement = **verrouillage** : les équipes sont figées avec leurs membres actifs du moment.
- Au lancement, chaque équipe inscrite devient un `TournamentTeam` (+ `TournamentParticipant`) : bracket (byes compris), avancement, XP, badges et clôture **existants** sont réutilisés.
  Pas d'inscription individuelle ni de déclaration unilatérale (`declareWinner` refuse sans confirmation d'équipe).
- **Résultat confirmé par les deux capitaines** : chacun déclare le gagnant (et les scores si `TOURNAMENT_SCORES_ENABLED`, dont la cohérence gagnant/score est vérifiée) ; la déclaration
  est **verrouillée** (immuable). Concordantes = match validé. Discordantes = désaccord : l'organisateur est prévenu et tranche (ou un ADMIN/OWNER de la communauté, « arbitre »).
  L'organisateur peut aussi trancher un match dont un capitaine est absent.
- **Annonces ciblées** (MP via la file, aucun appel direct, aucune mention, aucun message public) : invitation (capitaine), lancement (capitaines), déclaration à confirmer (capitaine adverse),
  **relance unique après 12 h** (cron `GET /api/cron/tournament-teams`), désaccord (organisateur). Le résolveur revérifie l'état à la livraison.
- La victoire finale réutilise l'annonce de fin existante des tournois.

## Limites et choix à confirmer
- « Arbitre » = organisateur ou ADMIN/OWNER de la communauté ; l'arbitre fixe Tower (#407) n'est pas réutilisé.
- Pas d'annonce publique à la création (MP aux capitaines seulement), pas de fil Discord de tournoi.
- Invités d'une autre équipe (`TeamTournamentGuest`, PR « équipes : recruteurs ») et tête de série par niveau (`seedByAverageLevel`, PR « niveau par jeu ») : à brancher après leur fusion ;
  cette PR ne dépend d'aucune des deux. Tirage au sort aléatoire des positions du bracket.
- Les équipes inscrites sans membre actif au lancement sont retirées.
