# Matchmaking GameNight (§12) — état et manques

## Vérifié dans le dépôt
- `src/lib/player-classifieds.ts:7-11` impose l'adhésion active et `community.playerClassifiedsEnabled` pour activer la recherche de joueurs dans la communauté.
- `src/lib/community-admin.ts:94-103` permet à l'administrateur de basculer ce flag.
- Dernier relevé Neon sur The Tower : `playerClassifiedsEnabled=false`. **La recherche n'est pas ouverte**, même si le code existe.
- La PR #360 (« Qui joue ce soir ? ») est indépendante, avec son propre flag `WHO_PLAYS_TONIGHT_ENABLED`. Elle reste à fusionner et à tester.

## Filtres à ajouter après recette
1. Jeu (identifiant durable, recherche sans doublons de noms), plateforme et compatibilité cross-play.
2. Créneau horaire en **Europe/Paris**, durée et disponibilité ce soir / semaine.
3. Micro oui/non/facultatif, type de partie (détente/compétitif/coop), niveau « débutant accepté ».
4. Afficher une recherche vide clairement ; masquer les disponibilités expirées et les membres hors communauté.
5. Lien « Rejoindre » vers une équipe ouverte sans exposer une équipe complète.

## Tests
Deux comptes de communautés distinctes ; aucune annonce hors communauté ; suppression et expiration automatiques vérifiées ; pas de Discord réel tant que Preview non isolée. La liste reflète **des propositions**, pas des filtres déjà livrés.