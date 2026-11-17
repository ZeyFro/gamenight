# Bugs et incidents

Suivi courant : issues et PR GitHub ; cette note ne garde que les pointeurs.

## Connus à la dernière vérification
- Commandes /tower et /tower-admin non enregistrées (HTTP 403 à l'enregistrement par serveur) : voir [[TOWER_COMMANDES_GUILD]].
- Jetons OAuth Discord illisibles (déchiffrement) : repli par le bot en place ; cause à confirmer côté configuration.
- Restauration de sauvegarde Neon : preuve complète encore attendue — [[TOWER_SNAPSHOT_RESTORE_PROCEDURE]].

## Références
- Sécurité : [[SECURITE_CLAUDE]] · CSP : [[rapport-csp-bloquant]]
- Idempotence : [[TOWER_IDEMPOTENCE_AUDIT]]
- Obsolètes de preview : [[TOWER_OBSOLETE_PREVIEW_VARS]]

Ne jamais consigner de secret, de jeton ni de données personnelles dans un incident.
