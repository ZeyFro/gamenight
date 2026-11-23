-- Retour arrière MANUEL de 20261123140000_shared_rate_limit (jamais exécuté automatiquement).
-- Effet : supprime les compteurs de débit partagés (aucune donnée utile perdue : ils expirent en quelques minutes).
-- Avant : revenir à un code antérieur à la PR de limitation partagée (les actions sensibles écrivent dans cette table).
DROP TABLE "RateLimitWindow";
