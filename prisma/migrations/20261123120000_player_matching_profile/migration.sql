-- Cahier §12.2 et §12.3 : langues, habitudes de jeu et préférences d'ambiance déclarées par le joueur,
-- utilisées pour les filtres de Potes et les suggestions de partenaires compatibles.
-- Additive : trois listes facultatives, vides par défaut, aucune donnée existante modifiée.
ALTER TABLE "User" ADD COLUMN "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "playHabits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "communityPreferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
