-- Retour arrière MANUEL de 20261126210000_tournament_team_round_robin (jamais exécuté automatiquement).
-- Effet : un tournoi lancé en poule unique redevient lu comme un arbre éliminatoire (ses 10 matchs restent, l'avancement serait faux).
-- Avant : revenir à un code antérieur à cette PR (sinon les requêtes sur roundRobin échouent) et ne garder aucune poule en cours.
ALTER TABLE "TournamentTeamSettings" DROP COLUMN "roundRobin";
