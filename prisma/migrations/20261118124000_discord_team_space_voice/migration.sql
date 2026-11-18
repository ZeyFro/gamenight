-- Option A (décision du 18/11/2026) : chaque équipe a un salon textuel ET un salon vocal
-- privés permanents. Cette migration additive ajoute l'identifiant du salon vocal au lien
-- existant `DiscordTeamSpace` (créé par 20261118121000_discord_team_space, non fusionnée).
-- Nullable : une ligne créée avant l'option A (textuel seul) reste valide ; le provisionnement
-- suivant crée le vocal manquant et renseigne la colonne, sans recreer le textuel ni le rôle.
-- Aucune table existante modifiée, aucune suppression. Appliquée automatiquement après fusion
-- par `migrate-production.yml` (docs/MIGRATIONS.md), jamais au build.
ALTER TABLE "DiscordTeamSpace" ADD COLUMN "voiceChannelId" TEXT;

CREATE UNIQUE INDEX "DiscordTeamSpace_voiceChannelId_key" ON "DiscordTeamSpace"("voiceChannelId");
