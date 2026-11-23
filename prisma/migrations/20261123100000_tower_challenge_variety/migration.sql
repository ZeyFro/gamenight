-- Cahier §8.5 (variété des défis) et §9.1 (preuves anciennes indiquées explicitement).
-- Additive : deux colonnes facultatives ; les défis existants gardent la règle actuelle (preuve postérieure, code exigé).
ALTER TABLE "TowerChallengeDefinition" ADD COLUMN "allowsPastProof" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TowerChallengeDefinition" ADD COLUMN "category" VARCHAR(30);
