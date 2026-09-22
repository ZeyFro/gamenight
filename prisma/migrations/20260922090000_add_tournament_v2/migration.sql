-- V2 (parcours tournois) — annulation/suppression + notifications
-- maîtrisées. Additive uniquement : aucune colonne/valeur d'enum
-- existante n'est retirée ni renommée, aucun backfill destructif.

-- Nouveau statut CANCELLED (tournoi démarré, interrompu par son créateur
-- — matchs/résultats déjà enregistrés conservés, voir le commentaire du
-- champ dans schema.prisma). Un tournoi non démarré se supprime plutôt
-- que de transiter par cet état (rien à préserver).
ALTER TYPE "TournamentStatus" ADD VALUE 'CANCELLED';

-- Ping sélectif à la création — mêmes sémantiques EXACTES que
-- `Session.notifiedUserIds` (voir son commentaire, schema.prisma) :
-- colonne nullable sans backfill, `null` = comportement préservé pour tout
-- tournoi créé avant cette migration (aucune mention). Jamais une liste
-- d'accès : l'accès/l'inscription à un tournoi ouvert restent gouvernés
-- exclusivement par les règles existantes, non touchées ici.
ALTER TABLE "Tournament" ADD COLUMN "notifiedUserIds" JSONB;

-- Horodatage d'annulation, purement informatif (affichage) — `null` tant
-- qu'un tournoi n'a jamais été annulé.
ALTER TABLE "Tournament" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Nouvelle catégorie de préférence TOURNAMENT (n'existait tout simplement
-- pas avant ce chantier — aucune notification tournoi personnelle
-- n'existait pour la réutiliser/la simuler).
ALTER TYPE "UserNotificationCategory" ADD VALUE 'TOURNAMENT';
