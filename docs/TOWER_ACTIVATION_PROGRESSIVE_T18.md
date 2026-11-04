# T18 — Activation progressive The Tower

Statut : plan à approuver, aucune activation. Suivi : issue #400. Décisions : TOWER_DECISIONS_26_20261104.md et instructions récentes de Maxime. Ouverture 4 janvier 2027, repli 1er février.

## Préconditions

- Relecture Claude du SHA exact et CI complète verte ; distinguer branche, Preview et Production.
- Migration #370 appliquée avant son merge, après accord précis, précontrôles et snapshot Neon frais vérifié immédiatement avant --execute. #325 exclue.
- Recette isolée réussie ; Preview web ne peut pas tester crons/interactions Discord car #369 interdit leurs écritures. Ne pas contourner VERCEL_ENV.
- Vérifier l'application GameNight, la guild The Tower et les salons à partir de la configuration réelle ; aucune valeur de secret dans ce document.
- Inventorier les flags déjà actifs en environnement ET en base : ne pas les supposer OFF. Conserver une preuve de la valeur précédente sans recopier d'URL de connexion ni jeton.
- Arbitre indépendant disponible, catalogue validé, comptes test exclus conformément aux décisions, plan Atlas prêt pour éviter une double progression.

## Portes successives

| Porte | Action préparée | Accord et preuve avant action | Validation après action |
|---|---|---|---|
| A | Vérifier/renseigner identifiants TOWER_DISCORD_GUILD_ID, TOWER_DISCORD_CHANNEL_ID et TOWER_DISCORD_GENERAL_CHANNEL_ID si manquants | Proposition des noms, périmètre Production et IDs non secrets ; accord variables distinct | Correspondance des destinations ; aucun message test non autorisé |
| B | Enregistrer /tower et /tower-admin via le script de #363 | Lire le script actuel, application/guild attendues, commandes existantes et diff ; accord enregistrement | Commandes réellement visibles et permissions correctes ; arrêt sur 403, ne pas réinviter automatiquement le bot |
| C | Activer le flag communautaire towerChallengesEnabled si nécessaire | Migration, membres actifs, état précédent et accord spécifique | Accès limité à la communauté prévue ; aucune activation d'une autre communauté |
| D | Activer TOWER_CHALLENGES_ENABLED si nécessaire | Recette et accord pour ce flag seul | Attribution/dépôt/vote avec testeurs autorisés ; pas de faux vote ni faux contenu Production |
| E | Importer le catalogue validé par /tower-admin | Version exacte, nombre solo/équipe, rapprochement des titres et accord import | Rapport ajouté/déjà présent ; contrôle idempotence sur recette avant Production |
| F | Activer TOWER_DISCORD_ANNOUNCE_ENABLED si nécessaire | Consentement, salon et préférences vérifiés ; accord flag seul | Livraison unique, absence de fuite et de saturation ; pas de publication sans action réelle autorisée |
| G | Activer TOWER_TEAM_DAILY_ENABLED si nécessaire | #396 relue, route protégée et recette hors Preview autorisée ; accord flag seul | Cadence externe seulement constatée en lecture, attribution idempotente ; aucune modification cron-job.org |
| H | Évaluer séparément TEAM_CAPTAIN_HANDOVER_ENABLED et MODE | Définition d'inactivité et simulation approuvées ; aucune activation implicite | Rapport de simulation puis décision dédiée avant MODE=execute |

Un seul nouveau flag par jour, y compris lorsqu'il s'agit d'un flag en base ; ne pas compenser un retard en activant plusieurs portes le même jour. Les jours sont relatifs à la fin des préconditions, pas des dates de promesse. Si le flag est déjà actif, consigner cet état et décider de l'essai approprié ; ne pas le basculer pour simuler une activation.

## Observation et arrêt

Après chaque porte : relever heure UTC, SHA, communauté, changement autorisé, résultat réel, erreurs classées sans secret et décision continuer/attendre. Une Preview READY et un HTTP 200 ne suffisent pas à valider le parcours utilisateur.

Incident : suspendre les actions suivantes et proposer le retour de la seule configuration concernée à sa valeur précédente. Tout changement de flag exige encore l'accord de Maxime. Aucun rollback/redéploiement/promotion Production, suppression Neon, restauration de snapshot ou modification de cron-job.org.

## Validation propriétaire

Le plan est prêt pour relecture, pas une autorisation globale. Chaque porte présente son action concrète et obtient son propre accord au moment de l'exécution. Critères de sortie : commandes visibles, droits conformes, parcours réel des preuves/votes, annonces consenties et uniques, absence de double progression Atlas/GameNight, historique préservé.
