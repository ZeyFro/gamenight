-- Cahier §11.2 : identité visuelle d'une équipe (couleur et emblème choisis par le capitaine).
-- Additive : deux colonnes facultatives, aucune donnée existante modifiée.
ALTER TABLE "CommunityTeam" ADD COLUMN "color" VARCHAR(7);
ALTER TABLE "CommunityTeam" ADD COLUMN "emblem" VARCHAR(16);
