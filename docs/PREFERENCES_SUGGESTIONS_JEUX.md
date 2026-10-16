# Préférences et refus appliqués aux suggestions — L3-03

Le profil propose deux listes distinctes : catégories préférées et catégories
refusées. Coopération, tir/FPS, stratégie, jeu de rôle, réflexion, course, sport
et horreur sont disponibles. Un même choix ne peut pas figurer dans les deux
listes. Décocher les cases les efface. Les tags libres existants (Chill,
Compétitif…) continuent à servir au choix des destinataires ; ils ne sont pas
transformés en catégories de jeu par une approximation du nom.

On peut aussi rechercher et refuser un jeu de la bibliothèque du serveur
affiché. Les ajouts répétés/concurrents sont idempotents. Retirer un refus
reste possible si ce jeu n'est plus accessible dans la bibliothèque actuelle.
Les actions utilisent exclusivement l'identité de la session et appliquent
authentification, validation et rate limit avant l'écriture. Une erreur de
base reste un échec. Les choix sont personnels et globaux au compte.

## Parcours de suggestions

L'onglet **Suggestions** de la bibliothèque ouvre
`/bibliotheque/suggestions`. L'entrée sans paramètre coche le visiteur. Les
liens et le formulaire conservent ensuite exactement la sélection explicite,
sans réinsérer le visiteur, même si tout a été décoché. Maximum : 100 personnes.
La sélection entière est revalidée dans la communauté active ; une personne
inconnue, extérieure, révoquée ou issue d'un serveur suspendu invalide tous les
résultats. Isolation OFF conserve le périmètre global et les refus choisis.

Les candidats doivent être déclarés possédés (`owned:true`) par **chaque**
participant. Un refus de jeu nommé par une seule personne exclut le jeu en
SQL ; un refus de catégorie l'exclut ensuite du classement. Aucun tirage ni
repli n'assouplit ces refus. Les capacités minimales/maximales connues doivent
convenir au groupe ; une capacité inconnue est signalée sur le résultat.

Un jeu compte une préférence par participant intéressé, même si plusieurs de
ses catégories correspondent. Le classement utilise ce nombre, puis le nom et
l'identifiant pour départager les ex æquo. Les 24 premiers résultats sont
affichés avec le total. Les listes individuelles de préférences/refus ne sont
pas renvoyées au navigateur de la personne qui recherche ; les résultats
affichent seulement le score agrégé.

Ce parcours aide à choisir un jeu : il ne change pas les bibliothèques, les
votes, les vetos ponctuels, les invitations ou les tirages existants.

## Métadonnées et caches anciens

Les suggestions utilisent exclusivement les métadonnées déjà mémorisées.
Aucun appel IGDB, Steam ou Discord n'est effectué pendant cette recherche.
L'horreur vient du thème IGDB `Horror`, distinct des genres ([thèmes
IGDB](https://www.igdb.com/themes), [API officielle](https://api-docs.igdb.com/#game)).
La collecte détaillée existante demande désormais `themes.name` et mémorise
le résultat. Les anciens caches sans ce champ restent inconnus jusqu'à leur
actualisation par le parcours de fiche existant ; aucune réécriture ou
collecte massive n'est déclenchée.

Si un refus ne peut pas être vérifié faute de genres/thèmes, le jeu reste hors
des suggestions et un message l'explique. Pour la coopération, une saisie
manuelle prime sur le cache ; un `false` par défaut jamais vérifié n'est pas
assimilé à une preuve d'absence de coopération. Les préférences positives
inconnues ne donnent simplement aucun bonus.

## Stockage et validation

La migration additive `20261015200000_game_preferences` ajoute deux listes à
`User` et la table personnelle `UserGameRefusal` (clé user/jeu, suppressions en
cascade). Aucun modèle collectif, aucune dépendance, aucun secret ni migration
existante modifiés. Prisma validate/generate et la comparaison de schémas sans
base confirment le SQL. Une preview Vercel ne migre pas la base : son build
ne prouve pas le parcours authentifié avec ce schéma.

Les tests locaux ciblés couvrent catégories et métadonnées inconnues, refus
prioritaires, classement, bornes, authentification, identité forgée, recherche
du jeu, effacement et sélection GET. Un test a d'abord reproduit le remplacement
erroné d'une sélection explicite par le visiteur ; le correctif passe ensuite.
Les 21 tests spécifiques et les 8 gardes ciblés réussissent. Les 11 cas
Postgres supplémentaires couvrent l'intersection réelle, la confidentialité,
les deux types de refus, le classement, le changement de serveur, les retraits,
la suspension, isolation OFF, les écritures et l'ajout concurrent idempotent.
Ils sont ignorés localement faute de Docker/Postgres et doivent réussir en CI.
Suite locale complète : 1 571 tests réussis, 946 ignorés (dont les intégrations
Postgres sans serveur local), 230 fichiers. Typage TypeScript, lint et build
Next.js webpack validés ; aucun délai ni mécanisme de reprise des tests modifié.
Parcours authentifié/mobile non vérifié. Aucun accès Neon ou Discord réel.

Reprise locale : #234 et #235 sont fusionnées dans `main`. La branche de
reprise #236 est intégrée avec ses identifiants et son matériel, en conservant
les préférences, les refus et les trois formulaires indépendants. Les migrations
additives des trois lots sont conservées. #236 et #237 restent des PR ouvertes ;
les contrôles doivent porter sur leurs derniers commits avant toute fusion.
