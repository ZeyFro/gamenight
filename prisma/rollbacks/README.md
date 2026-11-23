# Retours arrière des migrations (manuels)

Un fichier `<nom de la migration>.sql` par migration créée à partir du 23 novembre 2026 (garde : `src/lib/migrations-rollback.test.ts`).

- **Jamais exécuté automatiquement** : ni par le build, ni par `migrate-production.yml`.
- Sert seulement sur décision de Maxime, après un incident, et **avant** de revenir au code précédent.
- Testé dans la CI (`src/lib/migrations-rollback.integration.test.ts`) : dans une transaction annulée, le retour arrière puis la migration s'enchaînent sans erreur sur la base de test.
- Une migration additive se défait en supprimant ce qu'elle ajoute : **les données écrites dans ces colonnes depuis la migration sont perdues**. Préférer laisser la colonne en place (l'ancien code l'ignore) : le retour arrière n'est utile que si la migration elle-même gêne.

Procédure complète : [docs/MIGRATIONS.md](../../docs/MIGRATIONS.md), section « Retour arrière d'une migration ».
