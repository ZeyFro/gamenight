-- Chantier annonces Discord bot (salons/fils) — additive uniquement.
-- Ajoute la colonne qui fige, une fois pour toutes à la création de
-- chaque session, quel chemin d'envoi Discord (webhook existant vs bot)
-- lui est associé. Défaut `false` (webhook) pour TOUTE session déjà
-- existante à l'application de cette migration : comportement historique
-- inchangé, aucun backfill nécessaire au-delà du défaut de colonne
-- lui-même. Voir le commentaire du champ dans schema.prisma pour le
-- raisonnement complet (pourquoi ce n'est pas relu depuis la variable
-- d'env à chaque action ultérieure).
ALTER TABLE "Session" ADD COLUMN "announceViaBot" BOOLEAN NOT NULL DEFAULT false;
