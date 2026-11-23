-- Retour arrière MANUEL de 20261124100000_tower_participant_confirmation (jamais exécuté automatiquement).
-- Effet : supprime l'état de confirmation des participants d'équipe (donnée perdue). Les participants redeviennent tous récompensables.
-- Avant : revenir à un code antérieur à cette PR (sinon les requêtes sur confirmedAt échouent).
ALTER TABLE "TowerChallengeAttemptParticipant" DROP COLUMN "confirmedAt";
