-- Fix bug remonté (audit avant merge #95) — l'exclusivité par cible n'était
-- garantie que pour des réservations STRICTEMENT SIMULTANÉES (verrou
-- advisory transactionnel, relâché au commit). Deux réservations
-- SÉQUENTIELLES sur la même cible pouvaient toutes les deux aboutir
-- (reproduit à la main via psql avant ce correctif — voir
-- src/lib/notification-delivery.ts et le README pour le détail). Corrigé
-- en vérifiant, SOUS le verrou advisory, qu'aucune réservation active
-- n'existe déjà pour la cible avant d'en poser une nouvelle — garantie
-- désormais valable entre transactions simultanées ET séquentielles.
--
-- `reservationToken` : remplace `reservedBy` comme condition de
-- finalisation. `reservedBy` restait une simple étiquette choisie par
-- l'appelant (ex. identifiant de worker) — potentiellement réutilisée
-- d'une réservation à l'autre (redémarrage, identifiant statique), ce qui
-- aurait permis à un traitement obsolète de finaliser à tort une
-- réservation plus récente si les deux partageaient le même `reservedBy`.
-- `reservationToken` est généré aléatoirement (`crypto.randomUUID`) à
-- CHAQUE réservation réussie, jamais choisi par l'appelant : deux
-- réservations successives de la même ligne ont toujours des jetons
-- différents, donc une finalisation tardive avec un jeton périmé ne peut
-- jamais correspondre à la réservation courante, même si `reservedBy` est
-- identique aux deux réservations.

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN "reservationToken" TEXT;

-- CreateIndex
-- Sert la vérification d'exclusivité par cible au moment du claim (aucune
-- autre livraison RESERVED sur le même targetSlot, toutes opérations
-- confondues) et le lookup du SEND déjà envoyé dont une EDIT/ARCHIVE
-- dépend.
CREATE INDEX "NotificationDelivery_targetSlot_status_idx" ON "NotificationDelivery"("targetSlot", "status");
