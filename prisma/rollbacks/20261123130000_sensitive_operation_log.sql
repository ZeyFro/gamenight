-- Retour arrière MANUEL de 20261123130000_sensitive_operation_log (jamais exécuté automatiquement).
-- Effet : supprime le journal des opérations sensibles (historique perdu).
-- Avant : revenir à un code antérieur à la PR du journal (les actions d'administration écrivent dans cette table).
DROP TABLE "SensitiveOperationLog";
