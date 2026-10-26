# The Tower 2.0 — architecture et migration prudente

État de conception au 26 octobre 2026. Ce document s’appuie sur l’instantané REST réel de The Tower pris le 26 octobre à 19:12 UTC et sur le code de `origin/main` (`5bed623`). L’export privé complet reste local ; il ne doit pas être commité ni transféré. Ce relevé décrit la configuration, pas l’activité ni l’usage.

## Inventaire vérifié et décisions

L’audit compte 16 catégories, 37 salons textuels, 19 vocaux, aucun forum, aucun salon Discord de type annonce, aucun événement planifié, 197 rôles et 313 overwrites de rôles. Les 72 catégories/salons sont classés « conserver » par l’outil. Aucun élément n’est démontré comme supprimable ou archivable. Les catégories textuelles décoratives et noms répétés ne suffisent pas à conclure qu’ils sont inutilisés.

La configuration observée couvre l’accueil/règlement, une place centrale, les actualités, les vocaux généraux et par jeu, quatre espaces de jeu, la communauté, GameNight, les tickets, la modération et des intégrations ludiques. La capture montre deux catégories de tickets vides; elles peuvent être des destinations dynamiques de bot. Les salons vocaux homonymes sont rangés par jeu et ne sont pas des doublons démontrés.

Les noms et identifiants détaillés des catégories et salons restent dans le rapport local privé `.private-audit/discord/TOWER_DISCORD_INVENTORY.md`; ce relevé n’est pas publié dans le dépôt public. L’instantané ne comprend aucun message, activité, membre ni attribution de rôle. Il ne permet donc pas d’établir la fréquence d’usage, de vérifier la propriété d’un rôle, ni d’autoriser une fusion ou une suppression. Les rôles d’administration et overwrites spécifiques demandent une vérification d’usage et de propriétaires avant toute réduction.

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

### Premier incrément réalisé sur la branche de travail

La branche `codex/tower-coordinator` ajoute un registre d’équipes par communauté (jeu, plateforme, projet, taille, responsable, membres, recrutement ouvert/fermé), une inscription/désinscription et un plafond de trois créations par personne sur 24 h. Les places et le plafond sont vérifiés dans une transaction sérialisable; les adhésions inactives ne comptent pas. Si le responsable quitte la communauté, l’équipe reste visible et le plus ancien membre actif peut reprendre la fermeture du recrutement. L’activation est réglée par communauté, OFF par défaut, depuis l’administration existante; aucune notification Discord ou récompense XP n’est émise.

Cette première tranche ne lie pas encore les équipes aux séances/calendriers et ne propose pas de transfert manuel du responsable. Sa migration est additive; la bascule OFF masque le parcours sans effacer ses données. Une restauration de schéma après écritures nécessiterait une sauvegarde et un plan de conservation des inscriptions avant retour arrière; aucune migration Production n’a été lancée.

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
