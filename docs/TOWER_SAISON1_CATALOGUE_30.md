# The Tower — Catalogue de la saison 1 (proposition à valider)

> **Non importé, non activé.** 36 défis : 26 solo et 10 équipe ; 13 faciles (+1 étage), 13 moyens (+2), 10 difficiles (+3). Le barème +1/+2/+3 est **confirmé**. Toutes les preuves se limitent à des captures de jeu et des descriptions ; aucun achat ni photo privée obligatoire pour les cinq nouveaux défis gratuits.

## Compatibilité des commandes existantes

Les définitions sont directement dans les tableaux lus par les imports existants, sans nouveau schéma :
- `src/lib/tower-challenge-starter-catalogue.ts` : **22** défis historiques repris par `/tower-admin importer` ; **4 défis sociaux v2** sont exportés séparément et ne sont pas encore importés automatiquement.
- `src/lib/tower-team-challenge-starter-catalogue.ts` : **8** défis historiques repris par `/tower-admin importer-equipe` ; **2 défis équipe faciles v2** sont exportés séparément et ne sont pas encore importés automatiquement.

Les fonctions `importSoloTowerChallengeStarterPack` et `importTeamTowerChallengeStarterPack` de `src/lib/tower-challenges.ts` évitent les doublons de titres par communauté et mode. **Cette PR n’élargit pas encore ces imports** afin de ne pas modifier `tower-challenges.integration.test.ts`, réservé par #373 ; l’intégration des 6 nouveaux défis sera faite après libération de ce fichier. Attention : l'import ne conserve pas un champ de difficulté indépendant ; le niveau est représenté par `rewardFloors`. Il ne doit pas être lancé tant que les commandes ne sont pas enregistrées et qu'une recette isolée n'a pas eu lieu.

## Tableau de revue

| N° | Défi | Type | Difficulté |
| ---: | --- | --- | --- |
| 1 | Le guide touristique du chaos | solo | Moyen |
| 2 | La légende de l’objet banal | solo | Facile |
| 3 | La victoire la moins glorieuse | solo | Moyen |
| 4 | Le trophée invisible | solo | Facile |
| 5 | Le musée du plan foireux | solo | Moyen |
| 6 | La critique cinq étoiles | solo | Facile |
| 7 | Carte postale de nulle part | solo | Moyen |
| 8 | Le boss du rien | solo | Moyen |
| 9 | Zoom sur le détail | solo | Facile |
| 10 | Le détour diplomatique | solo | Difficile |
| 11 | Un mot, tout un jeu | solo | Facile |
| 12 | Le podium des pires idées | solo | Moyen |
| 13 | Le jeu gratuit du soir | solo | Facile |
| 14 | Le menu digne du musée | solo | Facile |
| 15 | Première découverte gratuite | solo | Facile |
| 16 | La carte postale gratuite | solo | Facile |
| 17 | L'astuce qui ne coûte rien | solo | Facile |
| 18 | Le guide des trois obstacles | solo | Difficile |
| 19 | L'expédition de la seconde chance | solo | Difficile |
| 20 | L'enquête des cinq détails | solo | Difficile |
| 21 | Le défi de patience raisonnée | solo | Difficile |
| 22 | Le reportage des trois actes | solo | Difficile |
| 23 | Le comité des architectes douteux | équipe | Difficile |
| 24 | La mission avec un plan trop ambitieux | équipe | Difficile |
| 25 | Le musée des décisions collectives | équipe | Moyen |
| 26 | Le boss nommé par le conseil | équipe | Moyen |
| 27 | La stratégie votée à main levée | équipe | Difficile |
| 28 | La photo de classe du jeu | équipe | Moyen |
| 29 | Les experts du détail inutile | équipe | Moyen |
| 30 | La cérémonie de la victoire modeste | équipe | Difficile |
| 31 | Premier contact GameNight | solo social | Facile |
| 32 | Le passeur de jeu | solo social | Moyen |
| 33 | La soirée surprise | solo social | Moyen |
| 34 | Le duo de l’inconnu | solo social | Difficile |
| 35 | Le salut de l’escouade | équipe | Facile |
| 36 | Le mini-objectif collectif | équipe | Facile |

## Fraîcheur de la preuve (§9.1)

Le catalogue seul ne peut pas prouver qu’une capture a été produite après l’attribution. Le mécanisme recommandé est un **code de preuve propre à chaque tentative**, généré côté serveur uniquement après l’attribution (par exemple `TWR-7K3P`), affiché sur la fiche du défi et demandé dans la preuve. Il peut apparaître dans un chat/écriteau du jeu lorsque c’est raisonnable, ou dans une composition de preuve GameNight associant la capture au code.

Une alternative doit rester possible pour les jeux où l’insertion du code est impossible. Le code n’est **pas encore implémenté dans cette PR** : la logique d’attribution est actuellement réservée par #373. Tant que ce mécanisme n’est pas livré et testé, aucune preuve ne doit être présentée comme techniquement garantie postérieure à l’attribution.

## Conditions avant import

1. Vérifier après bêta que le barème confirmé 1/2/3 reste cohérent avec la difficulté réelle de chaque défi.
2. Relire les textes pour l'accessibilité, absence d'achat obligatoire, équité, protection de la vie privée et règles du serveur.
3. Tester les imports sur une branche de base isolée et un serveur Discord de recette avec commandes guild-only ; vérifier zéro doublon au deuxième passage.
4. Ne pas importer en production ni activer les flags sans validation du propriétaire. La saison et le calendrier restent à décider.
