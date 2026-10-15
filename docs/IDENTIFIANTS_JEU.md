# Identifiants de jeu — L3-01

Dans `/profil/parametres`, chaque membre peut renseigner ou effacer ses
identifiants PSN, Xbox, Nintendo Switch, Epic Games et Battle.net. Les espaces
externes sont retirés ; un champ vide devient `null`. La limite de saisie est
de 100 caractères par champ, sur une seule ligne. Les pseudonymes sont
déclaratifs : aucun compte distant n'est interrogé ou lié par ce formulaire.
Le compte Steam conserve son parcours de liaison et de synchronisation.

Les valeurs renseignées apparaissent dans l'en-tête de `/potes/[id]`, après
authentification et autorisation par `canViewPote`. Les champs vides ne sont
pas affichés. Les identifiants sont globaux au compte, comme son pseudo ; les
membres autorisés à consulter sa fiche peuvent les lire. Le formulaire
explique cette visibilité avant l'enregistrement. Le contenu est rendu comme
texte, sans construire de lien depuis la valeur saisie.

L'action serveur tire l'identité exclusivement de la session authentifiée.
Elle ignore un `userId` ou un identifiant Steam forgé, applique le rate limit,
valide l'ensemble des cinq champs avant une seule écriture et invalide les
paramètres ainsi que la fiche du membre. Une panne de base reste un échec,
sans message de succès trompeur.

## Stockage et validation

La migration additive `20261015183000_add_gaming_identifiers` ajoute cinq
colonnes nullable `VARCHAR(100)` à `User`. Elle ne modifie ni les migrations
existantes ni les données ou contraintes Steam. Aucune dépendance ni variable
d'environnement supplémentaire. Le build direct ne lance aucune migration.
La preview Vercel ne migre pas la base : un build vert ne prouve donc pas le
parcours authentifié avec ces colonnes. La CI doit appliquer toutes les
migrations sur son service Postgres jetable avant les tests.

Les tests ciblés couvrent la validation, l'effacement, l'authentification,
l'identité forgée, le rate limit, les erreurs d'écriture et la confidentialité
de lecture / l'échappement HTML : 15 réussites. Les deux tests de persistance
exécutent la vraie action sur Postgres et vérifient les cinq valeurs, la
conservation de Steam, l'absence de modification du tiers et le refus sans
écriture d'un formulaire invalide. Ils sont ignorés localement, faute de
Docker / Postgres sur ce PC ; ils doivent réussir en CI avant toute fusion.
Les 40 tests de garde ciblés, Prisma validate / generate, TypeScript et lint
réussissent. La suite locale complète termine à 1 565 réussis et 937 ignorés
(169 fichiers réussis, 59 ignorés). Le build direct Webpack réussit également.
Le parcours navigateur authentifié/mobile n'est pas vérifié ; les contrôles
de rendu ne le remplacent pas. Aucun appel Neon ou Discord réel.

Ce lot est indépendant d'O06 (#234), dont CI #120 et Vercel sont verts sur
`2486f6d`. Sa fusion reste bloquée par la revue d'approbation automatique,
qui exige une confirmation utilisateur explicite de la mutation distante.
Le SHA validé est préservé ; aucun contournement de cette décision.
