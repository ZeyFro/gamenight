-- Correction de données : une saisie manuelle a laissé un Minecraft avec
-- minPlayers=999 (probable faute de frappe), ce qui l'excluait de tout
-- calcul "jouable" pour F5. On le ramène au défaut sûr (2), cohérent avec
-- la nouvelle validation (1-100) sur l'ajout manuel. Ciblé strictement sur
-- Minecraft et sur des valeurs aberrantes (>100), pour ne toucher aucune
-- autre donnée.
UPDATE "Game"
SET "minPlayers" = 2
WHERE "name" = 'Minecraft' AND "minPlayers" > 100;
