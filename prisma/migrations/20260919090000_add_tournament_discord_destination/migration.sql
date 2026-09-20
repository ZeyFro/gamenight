-- Revue ciblée avant merge #100 (contrôle de destination Discord) —
-- additive uniquement. NE MODIFIE PAS la migration déjà appliquée
-- 20260918100000_add_tournament_announce_via_bot.
--
-- Persiste la destination Discord (guildId/channelId) figée à la création
-- de chaque tournoi bot, en plus du booléen `announceViaBot` existant —
-- voir le commentaire du champ dans schema.prisma pour le raisonnement
-- complet (élimine le besoin de relire la configuration Discord live pour
-- le premier SEND, y compris pour un tournoi créé mais pas encore
-- annoncé). Colonnes nullables, aucun défaut à calculer : `NULL`/`NULL`
-- pour tout tournoi déjà existant (webhook, comportement inchangé) et
-- pour tout tournoi bot créé avant cette migration (cas théorique, la
-- catégorie n'a jamais été activée en production) — pas de backfill
-- nécessaire dans les deux cas.
ALTER TABLE "Tournament" ADD COLUMN "discordGuildId" TEXT;
ALTER TABLE "Tournament" ADD COLUMN "discordChannelId" TEXT;
