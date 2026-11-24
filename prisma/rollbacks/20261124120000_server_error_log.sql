-- Retour arrière MANUEL de 20261124120000_server_error_log (jamais exécuté automatiquement).
-- Effet : supprime la table ServerErrorLog (journal d'erreurs serveur, 30 jours au plus) ; ces lignes sont perdues.
-- Avant : revenir à un code antérieur à cette PR (aucun autre code ne lit cette table ; l'ancien code l'ignore, donc la laisser en place est aussi sans risque).
DROP TABLE "ServerErrorLog";
