-- Chantier annonces Discord tournois (#🏆-tournois, fil dédié par tournoi)
-- — additive uniquement. Même colonne que `Session.announceViaBot` (voir
-- prisma/migrations/20260917090000_add_session_announce_via_bot), appliquée
-- au modèle Tournament : fige, une fois pour toutes à la création de chaque
-- tournoi, quel chemin d'envoi Discord (webhook existant vs bot) lui est
-- associé. Défaut `false` (webhook) pour TOUT tournoi déjà existant à
-- l'application de cette migration : comportement historique inchangé,
-- aucun backfill nécessaire au-delà du défaut de colonne lui-même. Voir le
-- commentaire du champ dans schema.prisma pour le raisonnement complet.
ALTER TABLE "Tournament" ADD COLUMN "announceViaBot" BOOLEAN NOT NULL DEFAULT false;
