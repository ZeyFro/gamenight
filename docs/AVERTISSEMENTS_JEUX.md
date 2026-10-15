# Avertissements et langues — L3-04

Chaque fiche de jeu expose les jumpscares, le risque de mal des transports,
les langues des textes et celles de l'audio. Les deux risques ont trois états :
présence signalée, absence déclarée, inconnu (`null`). Les langues sont des
déclarations libres, limitées à 120 caractères chacune ; vide signifie inconnu.
Les jeux existants restent inconnus après la migration additive
`20261015210000_game_warnings`. Aucun titre, genre ou cache externe ne sert à
deviner ces informations.

Un utilisateur connecté qui possède encore le jeu (`UserGame.owned:true`)
peut modifier ces données partagées depuis la fiche. Le prédicat de possession
fait partie de l'écriture SQL, sans accepter d'identité provenant du formulaire.
Le serveur vérifie les champs et le rate limit ; le client affiche les erreurs
de validation, perte de possession et panne. Aucune erreur de base n'est
transformée en succès. Le formulaire permet d'effacer les valeurs, puis la fiche
est actualisée. Les imports et les anciennes actions d'édition ne touchent pas
ces champs. Les autres informations du jeu restent conservées.

La date de dernière déclaration est affichée (jour français, fuseau Paris).
La provenance est explicite : informations déclarées par les joueurs, à vérifier
pour la version jouée. Une absence déclarée n'est pas une garantie d'absence de
risque. Ces informations sont globales au jeu, comme ses autres métadonnées ;
elles n'exposent aucune préférence personnelle ni liste de possesseurs.

## Avant participation

- Fiche : avertissements visibles indépendamment du chargement IGDB.
- Création de soirée avec un jeu présélectionné : informations avant validation.
- Vote de jeu : encart avant le bouton de chaque proposition.
- Jeu décidé : encart avant les places et la liste d'attente.
- Partie immédiate : encart du jeu choisi avant Démarrer ; un nouveau jeu sans
  déclaration reste inconnu. Sur la page détail, encart avant Rejoindre et données
  relues dans la vue serveur actualisée toutes les 30 secondes. Un changement de
  jeu ne réutilise pas les avertissements du précédent. En cas de panne de cette
  actualisation, le message existant indique que l'état affiché date du dernier
  chargement réussi.

Les accès aux soirées et parties conservent leurs contrôles existants. Pas de
notification ni de nouvelle requête IGDB/Steam ; pas de dépendance ajoutée. Les
avertissements informent avant participation et ne bloquent pas une inscription.

## Vérification et intégration

Tests dédiés : validation/normalisation, effacement, identité forgée, contrôle
atomique de possession, absence d'écriture partielle, propagation des erreurs ;
rendu des trois états, langues échappées et date, envoi/erreurs du formulaire,
changement de sélection avant Démarrer. Les quatre cas PostgreSQL vérifient la
persistance, les anciens jeux inconnus, l'accès retiré, la conservation des
métadonnées et les vues réelles de parties après modification/changement du jeu,
y compris la sérialisation ISO de la date.

Les tests PostgreSQL locaux sont ignorés faute de Docker/Postgres. La CI doit
appliquer la migration sur son service jetable et réussir tous les cas avant
toute intégration. Le parcours authentifié/mobile reste à vérifier ; une preview
verte ne démontre pas l'application de la migration. Aucun accès Neon ni envoi
Discord réel n'est utilisé pour la validation.

Validation locale : 1 559 tests réussis, 939 ignorés ; neuf tests spécifiques
réussis, quatre PostgreSQL ignorés. Typage TypeScript, lint et build webpack
réussis. Aucun délai de test ni mécanisme de reprise modifié.

Lot indépendant depuis `main` 486b39d, PR #234–237 encore ouvertes. La revue
automatique a refusé la sortie du brouillon et la fusion de #234 pour absence
d'autorisation explicite reconnue comme fiable. Le propriétaire demande de ne
pas répéter cette action : aucune tentative de fusion n'est faite. Après les
autres lots, réconcilier les changements de schéma, de pages et de roadmap puis
rejouer les contrôles sur le nouveau commit.
