-- Retour arrière MANUEL de 20261127140000_session_space_access_revoked (jamais exécuté automatiquement).
-- Effet : supprime le marqueur de coupure d'accès des espaces de soirée ; les valeurs sont perdues.
-- Avant : revenir à un code antérieur à cette PR. L'ancien code ignore cette colonne, donc la laisser en place est aussi sans risque.
ALTER TABLE "SessionDiscordSpace" DROP COLUMN "accessRevokedAt";
