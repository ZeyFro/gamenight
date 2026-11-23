-- Retour arrière MANUEL de 20261123120000_player_matching_profile (jamais exécuté automatiquement).
-- Effet : retire langues, habitudes et ambiance déclarées par les joueurs (réponses perdues).
-- Avant : éteindre PLAYER_MATCHING_ENABLED et revenir à un code antérieur à la PR #527.
ALTER TABLE "User" DROP COLUMN "communityPreferences";
ALTER TABLE "User" DROP COLUMN "playHabits";
ALTER TABLE "User" DROP COLUMN "languages";
