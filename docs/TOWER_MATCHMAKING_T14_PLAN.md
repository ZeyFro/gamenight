# T14 — plan de matchmaking GameNight

Préparation locale du 4 novembre 2026, base `main` à `7cd6015`.
La tranche 1 est désormais développée localement avec tests ciblés. Les autres tranches restent proposées. Aucune migration exécutée ni état de Production vérifié pour cette préparation.

## État vérifié dans cette base

| Besoin | Données et comportement existants | Manque |
|---|---|---|
| Annonces ponctuelles | `/joueurs`, publication jeu/message pendant 24 h, suppression auteur/admin | Aucun filtre de consultation |
| Jeu | `PlayerClassified.gameId`, relation `Game` | Filtre GET par identifiant ; sélectionner aussi `game.id` dans la lecture |
| Plateforme | `User.availablePlatforms: String[]`, valeurs validées dans `player-equipment.ts` | Filtre sur le matériel déclaré ; aucune plateforme propre à une annonce |
| Micro | `User.microphoneAvailable: Boolean?` | Filtre explicite ; ne pas confondre inconnu et non disponible |
| Disponibilités | `WeeklyAvailability`, `AvailabilityOverride`, fonctions `availability.ts` et `wallclock.ts` | Pas de créneau/durée structurés sur l'annonce ; aucun filtre d'annonce existant |
| Style | `GameStyleProfile` : tryharder, ambianceur, stratège, chaos | Pas de type de partie détente/compétitif/coop ; ne pas convertir automatiquement les axes |
| Cross-play | Pas de donnée fiable identifiée | Ne pas affirmer une compatibilité à partir des plateformes du joueur |
| Sécurité et expiration | Communauté active, adhésion active, module communautaire ; expiration et auteurs retirés exclus de la liste | Préserver ces contraintes dans tous les filtres |

Les disponibilités sont représentées par une horloge murale Paris, avec les champs UTC servant de représentation interne ; `wallClockNow()` convertit l'instant actuel en heure locale Paris. Ce stockage ne représente pas un instant UTC réel. Ne pas appliquer une seconde conversion.

## Tranche 1 — jeu et matériel déclaré, sans migration

1. Créer `src/lib/player-classified-filters.ts` : parser les paramètres GET `gameId`, `platform`, `microphone` avec validation, listes de valeurs autorisées et traitement uniforme des valeurs multiples. Une entrée invalide produit un message lisible ; elle ne doit pas élargir silencieusement les résultats.
2. Étendre `listPlayerClassifieds` dans `src/lib/player-classifieds.ts` avec un argument de filtres facultatif, conservant la signature actuelle utilisable sans filtre. Combiner les contraintes existantes et les filtres par ET. Filtrer le jeu sur son ID et la plateforme sur `createdBy.availablePlatforms`.
3. Pour le micro, proposer « Tous », « Disponible », « Non disponible », « Non renseigné ». Traduire en absence de condition, `true`, `false`, `null`. Une donnée manquante ne répond ni à oui ni à non. Une liste de plateformes vide signifie non renseigné ; elle ne prouve pas une incompatibilité.
4. Ajouter un formulaire GET dans `src/app/joueurs/page.tsx` avec les mêmes valeurs validées, sélection persistante dans l'URL et lien de remise à zéro. Ne pas mélanger le formulaire de publication POST et la recherche GET. Libeller plateforme et micro comme informations du profil du joueur ; ce ne sont pas des exigences de la partie.
5. Distinguer « Aucune annonce en cours » et « Aucune annonce ne correspond aux filtres ». Les jeux homonymes restent distincts par ID ; afficher un discriminant si les données disponibles permettent de les distinguer, sans fusionner arbitrairement leurs résultats.

Fichiers prévus : les trois fichiers ci-dessus, nouveaux `src/lib/player-classified-filters.test.ts` et `src/app/joueurs/page.test.tsx`, extension de `src/lib/player-classifieds.integration.test.ts`. Aucun changement Prisma ni nouveau flag nécessaire pour ces filtres de lecture ; la fonctionnalité garde la porte communautaire existante.

## Tranche 2 — exigences et créneaux d'annonce, migration additive

Attendre l'intégration de #370 avant de modifier `prisma/schema.prisma`, fichier actuellement réservé. Préparer ensuite une PR brouillon distincte pour ce lot, une fois une place disponible sous le plafond de PR de code.

Champs facultatifs proposés sur `PlayerClassified`, à valider lors de l'implémentation :

- `platform` : valeur de plateforme autorisée, distincte du matériel possédé par l'auteur ; absence = non renseigné.
- `microphoneRequirement` : choix dédié requis/facultatif/sans micro ; absence = non renseigné. Ne pas le dériver de `User.microphoneAvailable`.
- `partyType` : choix dédié détente/compétitif/coop ; absence = non renseigné. Les axes du profil ne remplissent pas ce champ.
- `beginnersWelcome: Boolean?` : oui, non ou non renseigné.
- `startsAt` et `durationMinutes` : créneau ponctuel et durée validés ; absence = non renseigné. Formaliser la convention de stockage avant migration pour rester compatible avec les dates murales existantes.

La migration doit être additive, sans réécriture des annonces anciennes ; les annonces `/ce-soir` continuent de fonctionner avec les champs nouveaux absents. Les index éventuels doivent répondre aux requêtes réellement retenues, pas être ajoutés par anticipation. Aucun script de migration exécuté dans cette préparation. Pour toute PR contenant une migration : signaler en tête l'application en Production avant merge, selon la procédure autorisée avec sauvegarde fraîche ; ne pas lancer cette opération automatiquement.

Parité UI/serveur : options et bornes partagées dans un module pur ; validation côté serveur à la création et à la lecture ; formulaire HTML ne servant jamais de seule protection. Les champs anciens restent acceptés. Revalider jeu et communauté côté serveur, y compris pour les requêtes forgées.

## Horaires Paris et limites à traiter

- Définir séparément le créneau de l'annonce et les disponibilités habituelles du joueur. Un profil disponible ne prouve pas que son annonce vise ce créneau.
- Utiliser les conventions existantes pour les filtres « ce soir » et « cette semaine » ; afficher explicitement Europe/Paris.
- Tester les semaines de passage à l'heure d'été/hiver, les frontières de date et les créneaux traversant minuit. Une heure locale répétée ou inexistante exige une politique explicite si un véritable instant est introduit ; ne pas laisser le fuseau du serveur décider.
- Les exceptions ponctuelles priment sur le planning hebdomadaire. Tester indisponibilité exceptionnelle, disponibilité exceptionnelle et journée entière. Une absence de planning signifie information inconnue, pas disponibilité garantie.
- Ne pas présenter `isAvailableAt`, qui teste un point horaire, comme une preuve de disponibilité pendant toute une durée. Une recherche par intervalle exige un calcul d'intersection/couverture testé.

## Validation prévue

| Niveau | Cas indispensables |
|---|---|
| Règles pures | Paramètres vides/invalides/multiples, plateformes inconnues, micro nullable, jeu par ID, combinaisons de filtres |
| Page | Labels et options cohérents avec le serveur, filtres conservés, remise à zéro, erreurs et états vides distincts |
| Postgres local | Deux communautés, module OFF, membre retiré, annonce expirée à la borne exacte, homonymes, filtres combinés ; aucune fuite de résultats |
| Tranche 2 | Annonces anciennes et `/ce-soir` sans champs nouveaux, exigences indépendantes du profil, validation contournant le HTML, horaires et overrides |
| Contrôles | Tests ciblés, lint des fichiers touchés, typecheck ; vérification de build avant publication |

Les intégrations utilisent uniquement un Postgres local jetable, jamais Neon. Aucun appel Discord réel. Tout test sauté reste explicitement signalé. Aucun test navigateur Production n'est prétendu réalisé.

## Dépendances et ordre réaliste

1. Recontrôler les fichiers réservés sur les têtes actuelles des PR avant implémentation. Le relevé local initial ne montre pas de collision pour `joueurs/*` et `player-classifieds*` avec #384/#385/#387/#388/#392/#394/#395/#396/#397 ; ce constat n'est pas une réservation distante actualisée.
2. Développer et tester la tranche 1 sur branche isolée : ordre de grandeur une demi-journée de développement/relecture, hors attente CI et recette. Estimation, pas engagement de délai.
3. Après #370, cadrer puis développer la tranche 2 : plusieurs étapes de développement et validation, probablement un à deux jours de travail selon la décision sur les dates et la migration ; aucune activation Production implicite.
4. Reporter cross-play jusqu'à obtention d'une source fiable. Relier une équipe ouverte seulement après #370 et vérification du recrutement, des places et de l'accès communautaire côté serveur.
5. Faire la recette réelle avec deux comptes et communautés distinctes dans un environnement isolé, puis relever séparément développé, configuré et testé réellement.

Le document `TOWER_MATCHMAKING_GAPS.md` contient un relevé historique : son état de #360 et son flag Neon ne doivent pas être repris comme constat courant sans nouvelle vérification.

## Checkpoint de développement local

Tranche 1 : formulaire GET jeu/plateforme/micro, validation serveur partagée, filtrage Prisma et états vides livrés localement. Micro inconnu traité par null. Signature de lecture compatible avec les appelants existants. Aucun changement de schéma ; horaires, type de partie et cross-play restent non développés. Tests de règles, de page et de composition de requête ciblés ; les tests avec mocks ne remplacent pas une intégration Postgres ni une recette navigateur.

Validation de cette tranche locale : 31 tests passés sur 5 fichiers (règles des filtres, composition de requête, page, annonces historiques, règles de ce soir), ESLint ciblé, génération des types Next et `tsc --noEmit` réussis. Intégration Postgres non exécutée : aucune base locale disponible pour cette mission. Build complet et recette navigateur non exécutés. L'absence de collision a été confirmée par le coordinateur sur les listes de fichiers distantes des PR en cours avant modification ; aucun fichier réservé n'a été modifié.

## Intégration du 6 novembre 2026

La branche #408 intègre #407 `6ec348d` et #406 `97353dc`, dont #370 `6cff66b`.
Les filtres et la commande conservent leurs tests existants : 60 tests ciblés
réussis sur PostgreSQL local avec Discord simulé ; typegen, TypeScript et lint
ciblé réussis. L'installation complète Node 22 par npm ci et la génération Prisma
ont réussi avec strict-ssl actif, sans désactivation TLS ni saut du postinstall.
Le résultat du build et de la CI est consigné dans #400 avant clôture de tâche.
La migration arbitre additionnelle reste uniquement locale ; aucun déploiement,
flag, commande Discord, migration distante ou essai authentifié réel effectué.
