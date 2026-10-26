# The Tower 2.0 — architecture et migration prudente

État de conception au 26 octobre 2026. Ce document s’appuie sur l’instantané REST réel du serveur The Tower (`553922938101825536`) pris le 26 octobre à 19:12 UTC et sur le code de `origin/main` (`5bed623`). L’export privé complet reste dans `.private-audit/discord` du worktree d’audit ; il ne doit pas être commité ni transféré. Ce relevé décrit la configuration, pas l’activité ni l’usage.

## Inventaire vérifié et décisions

L’audit compte 16 catégories, 37 salons textuels, 19 vocaux, aucun forum, aucun salon Discord de type annonce, aucun événement planifié, 197 rôles et 313 overwrites de rôles. Les 72 catégories/salons sont classés « conserver » par l’outil. Aucun élément n’est démontré comme supprimable ou archivable. Les catégories textuelles décoratives et noms répétés ne suffisent pas à conclure qu’ils sont inutilisés.

| Catégorie observée | ID | Enfants | Décision provisoire / destination logique |
|---|---:|---:|---|
| `_______|-Salons-textuel-|_______` | `553931981952516126` | 6 | Place centrale; conserver en vérifiant l’usage |
| `_________|-REGLEMENT-|__________` | `553934390229467175` | 3 | Accueil et intégration; conserver |
| `___|-Team League-Of-Legend-|__` | `553969237383970816` | 5 | Espace LoL; conserver si la communauté est active |
| `________|-Salle de repos-|________` | `553972592424386562` | 2 | AFK / détente; conserver |
| `______|-TEAM OVERWATCH-|______` | `553974866840125460` | 3 | Espace Overwatch; conserver si actif |
| `__________|-Affiche-|___________` | `554000746992107520` | 5 | Annonces et actualités; conserver |
| `_________|-TEAM CS-GO-|__________` | `556224891628814346` | 3 | Espace CS; conserver si actif |
| `Tribunal` | `576460995472523285` | 5 | Modération; visibilité à vérifier, ne pas déplacer |
| `•🔖tickets-off` | `734424863988776960` | 0 | Catégorie vide dans l’instantané; vérifier le bot de tickets |
| `•🔖tickets-on` | `734424902400081932` | 0 | Catégorie vide dans l’instantané; vérifier le bot de tickets |
| `_______|-TEAM VALORANT-|_______` | `734445254392021063` | 3 | Espace Valorant; conserver si actif |
| `_______|-Salons-Vocaux-|_______` | `734798647715168356` | 8 | Vocaux généraux; conserver |
| `________|-Communautée-|_______` | `735240308882800721` | 5 | Communauté, recrutement et activités; conserver |
| `__________|-Mudae-|__________` | `765556794726023178` | 3 | Intégration Mudae; vérifier avant toute évolution |
| `_______Irregular_______` | `854003747595747328` | 2 | Espace à droits spécifiques; conserver et auditer les droits |
| `GameNight` | `1557465639801589923` | 3 | Noyau événements; conserver |

Salons GameNight déjà identifiés : `⚙️annonce` (`1557685767151820851`), `🎮-soirées` (`1557465643849220126`), `🏆tournois` (`1557465648748302336`). Le premier est un salon texte standard, pas le type Discord « annonces ». Les salons vocaux homonymes sont rangés sous des catégories de jeux différentes : aucun regroupement n’est justifié par leur seul nom. Les deux catégories de tickets vides peuvent être des destinations dynamiques de bot.

L’instantané ne comprend aucun message, activité, membre ni attribution de rôle. Il ne permet donc pas d’établir la fréquence d’usage, de vérifier la propriété d’un rôle, ni d’autoriser une fusion ou une suppression. Voir la synthèse privée pour les contrôles de rôles et permissions; notamment les rôles `ADMINISTRATOR`, les overwrites d’`Irregular` et de `Examinateur` demandent une vérification d’usage et de propriétaires avant toute réduction.

## Structure cible simple

Le serveur Discord reste le lieu social et vocal; GameNight devient le registre durable des sessions, projets, équipes, tournois et progression. Pas de duplication systématique des données ni de messages automatiques. Le premier accès doit rester évident :

1. **Portail** : règlement et auto-rôle existants, puis annonces importantes.
2. **Place centrale** : discussion, recherche de joueurs, liens vers projets et sessions en cours.
3. **Équipes et projets** : fiches consultables dans GameNight avec jeu, plateforme, objectif, places, responsable et sessions; Discord conserve un canal d’échange général et les vocaux existants.
4. **Ascension** : progression, défis et saisons affichés dans GameNight; distinctions Discord restent cosmétiques tant que la correspondance des 134 rôles `Etage` et des attributions n’est pas vérifiée.
5. **Événements** : réutiliser les annonces GameNight existantes et les salons soirées/tournois; annonces Discord facultatives et désactivées par défaut.
6. **Vocaux** : garder les salons généraux et par jeu; les salons temporaires ou permissions supplémentaires ne sont ajoutés qu’après recette des permissions et parcours de retour arrière.
7. **Staff** : préserver Tribunal, tickets et espaces admin; aucun changement de visibilité ou de rôle sur la base du seul export.

Éviter d’ajouter un salon par jeu ou par équipe. Démarrer avec des liens et fils dans les espaces existants; créer au plus un salon seulement si l’usage et le volume le justifient. Les clubs peuvent jouer ailleurs : une équipe GameNight n’accorde aucun accès Discord supplémentaire.

## Fonctions déjà disponibles dans GameNight

Le code comporte déjà les séances et invitations, calendrier, tournois et équipes de tournoi, recherche courte de joueurs (`/joueurs`, annonces expirant en 24 h), sessions spontanées, XP et niveaux, badges, défis hebdomadaires, saisons/classements, succès collectifs et notifications in-app. Il faut les relier avant d’introduire des équivalents. Les annonces aux salons Discord et MP dépendent de drapeaux séparés; toute nouvelle notification reste désactivée par défaut.

La recherche `/joueurs` sert au matchmaking ponctuel, pas au recrutement durable d’une équipe : le prochain incrément communautaire peut donc ajouter une fiche de projet/équipe persistante, scopée par communauté et avec adhésion explicite, sans paiement ni mention automatique. Événements et XP doivent s’appuyer sur les événements GameNight existants, avec une source d’attribution idempotente et les limites anti-abus déjà utilisées par l’XP.

## Séquencement de livraison

1. **Fondations communautaires** : équipes/projets persistants, recrutement ouvert/fermé, inscription réversible, responsable et calendrier de sessions réutilisant les séances existantes. Opt-in communautaire ou désactivé par défaut si une évolution de configuration est nécessaire.
2. **Ascension visible** : présenter l’XP, les étages, badges, défis hebdomadaires et saison déjà calculés; définir les paliers cosmétiques après migration contrôlée des anciens rôles. Ne pas récompenser les messages bruts, invitations seules ou connexions forcées.
3. **Événements** : relier soirées et tournois aux équipes/saisons via les flux existants; rappels in-app facultatifs. Pas d’annonce Discord ni collecte vocale activée par défaut.
4. **Fidélisation** : missions et défis collectifs basés sur participation réelle, mise en avant des équipes et Hall of Fame alimenté par les saisons; test anti-spam et équité avant exposition.
5. **Discord** : proposer ensuite un manifeste d’ajouts uniquement (portail/ressources manquantes) avec permissions minimales, dry-run des droits effectifs et retour arrière. Ce document n’autorise aucune mutation du serveur.

Chaque incrément est une PR isolée, avec tests ciblés, migration additive uniquement si nécessaire et contrôles CI verts avant toute fusion. Aucun déploiement Production n’est autorisé par ce document.

## Migration et retour arrière

- **Avant un changement Discord** : nouvel instantané de configuration, inventaire des intégrations et propriétaires des permissions; sauvegarder le manifeste des IDs, positions, overwrites et réglages modifiés. L’audit du 26 octobre ne contient pas les attributions de rôles et ne constitue pas une sauvegarde complète.
- **Ajout non destructif** : créer un seul élément à la fois avec permissions explicites minimales, valider accès membre/non-membre et bot, puis publier le lien dans un espace existant. Les ajouts Discord autorisés sont réversibles par fermeture/archivage manuel selon la politique du serveur; aucune purge automatique.
- **Changement d’accès ou d’identité** : ne pas procéder sans propriétaire, affectations et effets résolus, plan de restauration, puis validation explicite. Cela inclut renommage/déplacement de salons, rôle de progression, fusion de rôles, overwrites, intégrations et permissions `ADMINISTRATOR`.
- **Données GameNight** : migrations Prisma additives et compatibilité avant/après; la désactivation d’une fonction ne supprime pas les données. Vérifier la sauvegarde restaurée en environnement isolé avant migration Production. Désactivation du flag = repli applicatif, puis éventuelle correction dans un commit séparé; ne jamais supprimer les acquis au rollback.
- **XP et rôles Etage** : conserver tous les rôles et attributions jusqu’à export/validation de la correspondance et de la distribution des 134 rôles. Phase de transition en lecture seule; aucun retrait automatique de rôle. Réconcilier divergences avant d’activer une attribution graduelle.

### Décisions à ne pas automatiser

À ce stade : aucune suppression, archive ou fusion de salons/rôles; aucune réduction de permission; aucune affectation ou migration automatique des rôles `Etage`; aucune publication Discord externe ou activation de collecte. Les éléments en attente de vérification sont les usages/owners des rôles sensibles, les intégrations de tickets, les catégories `Tribunal`, `Mudae`, `Salons-Vocaux` et `Salle de repos`, et l’activité réelle des espaces par jeu.
