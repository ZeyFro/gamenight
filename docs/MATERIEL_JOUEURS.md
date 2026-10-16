# Matériel et plateformes — L3-02

Le carnet de `/profil/parametres` permet de déclarer clavier/souris et manette
(plusieurs choix), les plateformes disponibles (Windows, macOS, Linux/Steam
Deck, PlayStation, Xbox, Switch, Android, iOS) et la disponibilité d'un micro.
Le micro distingue « oui », « non » et « non renseigné ». Les commandes et
plateformes non cochées restent non renseignées, sans déduire une incapacité.
Tout peut être effacé en décochant les options et en choisissant « non
renseigné » pour le micro.

Les renseignements apparaissent dans l'en-tête de la fiche d'un pote, après
authentification et contrôle `canViewPote`. Une fiche entièrement vide n'a
aucune carte de matériel. Les données sont personnelles au compte et visibles
par les membres autorisés à consulter sa fiche ; le formulaire le précise.
Elles ne constituent pas un état de présence en ligne et ne filtrent pas
automatiquement les jeux ou les invitations.

L'action serveur utilise l'identité de la session uniquement, applique le rate
limit, refuse tout choix hors catalogue et valide le formulaire entier avant
une seule écriture. Les sélections répétées utilisent `FormData.getAll` et
sont dédupliquées. Les champs Steam ou `userId` forgés ne sont jamais transmis
à la mise à jour. Les paramètres et la fiche sont invalidés après succès ; une
panne d'écriture reste un échec.

La migration additive `20261015190000_add_player_equipment` ajoute deux listes
vides par défaut et un booléen nullable à `User`. Prisma validate/generate et
la comparaison de schémas sans base confirment les trois colonnes et leur
SQL. Aucune migration existante, dépendance, variable ou connexion de service
ajoutée. Le build direct ne migre pas la base ; la preview Vercel n'applique
pas cette migration non plus. La CI doit migrer sa base Postgres jetable et
vérifier la persistance avant fusion.

## Vérification

Les 18 tests spécifiques locaux vérifient les choix multiples, l'effacement,
le micro à trois états, la borne de taille, les choix et l'identité forgés,
l'authentification, les erreurs d'écriture, le vrai formulaire HTML et le
contrôle d'accès avant lecture de la fiche. Deux tests supplémentaires
exécutent la vraie action sur Postgres : valeurs par défaut, modification,
conservation du tiers et de Steam, effacement, refus sans écriture partielle.
Ils restent ignorés localement : ce PC n'a ni Docker ni Postgres. Aucun accès
Neon ou Discord réel pour les remplacer. Suite locale complète : 1 568 réussis
et 937 ignorés (170 fichiers réussis, 59 ignorés). TypeScript, lint et build
direct Webpack réussissent également. Le parcours navigateur authentifié/mobile
reste non vérifié.

Lot indépendant de L3-01 (#235) et O06 (#234), préparé depuis `main`. Les
branches de fonctionnalités doivent être réconciliées avec `main` et leurs
contrôles relus avant chaque fusion ; les deux lots complètent les paramètres
et l'en-tête des potes.
