-- Retour arrière MANUEL de 20261123100000_tower_challenge_variety (jamais exécuté automatiquement).
-- Effet : retire la catégorie et l'indication « preuves anciennes » des définitions de défis (valeurs perdues).
-- Avant : revenir à un code antérieur à la PR #525.
ALTER TABLE "TowerChallengeDefinition" DROP COLUMN "category";
ALTER TABLE "TowerChallengeDefinition" DROP COLUMN "allowsPastProof";
