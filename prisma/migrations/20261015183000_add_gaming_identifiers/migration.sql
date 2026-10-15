-- Champs facultatifs, sans modification des comptes ni des liaisons Steam existants.
ALTER TABLE "User"
  ADD COLUMN "psnId" VARCHAR(100),
  ADD COLUMN "xboxGamertag" VARCHAR(100),
  ADD COLUMN "switchFriendCode" VARCHAR(100),
  ADD COLUMN "epicDisplayName" VARCHAR(100),
  ADD COLUMN "battleTag" VARCHAR(100);
