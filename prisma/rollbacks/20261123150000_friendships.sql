-- Retour arrière MANUEL de 20261123150000_friendships (jamais exécuté automatiquement).
-- Effet : supprime toutes les demandes d'ami et les amitiés (données perdues, non récupérables).
-- Avant : éteindre POTES_FRIENDS_ENABLED et revenir à un code antérieur à cette PR.
DROP TABLE "Friendship";
DROP TYPE "FriendshipStatus";
