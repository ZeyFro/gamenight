# Retour arrière du lot XP + vocal (6 migrations de #325)

Fichiers `NN_*.down.sql` : un par migration, à exécuter dans l'ORDRE INVERSE (06 → 01), chacun dans sa propre transaction.
**Jamais exécutés par un script applicatif, jamais au build.** Procédure complète, conditions d'arrêt et ordre de décision :
`docs/XP-MIGRATIONS-ROLLBACK.md`.

- Chaque fichier REFUSE (exception, transaction annulée) si le retour arrière détruirait des données applicatives.
- Pour les données vocales (migrations 02 à 05), la perte peut être acceptée explicitement, APRÈS export, avec
  `SET gamenight.allow_voice_data_loss = 'on';` dans la MÊME session psql, avant d'appeler le fichier.
- Chaque fichier supprime aussi sa ligne `_prisma_migrations` (recherche par suffixe : insensible au renommage de la phase 4).
- Usage : `psql "$URL" -v ON_ERROR_STOP=1 -f scripts/rollback-xp-lot/06_shop_balance_purchase_reason.down.sql`
- Répétition locale jetable : `scripts/rehearse-xp-rollback.sh` (127.0.0.1 uniquement).
