-- MIGRATION d'alignement (aucune donnée touchée) : rattrape deux écarts entre
-- l'historique des migrations et schema.prisma, détectés par `prisma migrate diff`.

-- UserNotificationPreference.updatedAt : @updatedAt est géré côté client Prisma,
-- le DEFAULT CURRENT_TIMESTAMP créé par la migration d'origine n'existe pas dans le schéma.
ALTER TABLE "UserNotificationPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Index unique de NotificationDelivery : nom tronqué à 63 caractères par Postgres
-- à la création, renommé avec le nom complet attendu par Prisma. Métadonnée seule.
ALTER INDEX "NotificationDelivery_eventId_channel_recipientKey_operati_key" RENAME TO "NotificationDelivery_eventId_channel_recipientKey_operation_key";
