# The Tower — règles d'équipes : préparation du lot 3

Cette branche est une proposition **non fusionnée**. Aucune migration exécutée sur Neon. Conformément au §26 :

- Capacité à la création : 2 à 8 membres, côté formulaire et validation serveur.
- Une équipe active par personne et par communauté. Index PostgreSQL unique `(communityId, userId)` sur `CommunityTeamMember`, complété par des contrôles métier dans une transaction sérialisable.
- Après un départ volontaire : `Membership.lastTeamLeftAt` impose 7 jours sans adhésion ni création d'une autre équipe dans la même communauté. En cas de dissolution, **seul le capitaine qui déclenche la dissolution** reçoit ce délai ; les autres membres sont libérés sans cooldown.
- Le capitaine actuel est représenté par `CommunityTeam.captainId`, initialisé depuis `createdById` lors de la migration. La passation modifie uniquement `captainId` : **l'identité historique du créateur reste conservée dans `createdById`**.
- L'activité du capitaine est définie provisoirement par une action de gestion du recrutement, ou par la dernière activité XP de sa communauté. Le code ne possède pas une mesure fiable du dernier login. Une passation après 30 jours se base sur le dernier événement de ces deux sources, et choisit le membre actif le plus ancien.
- La fonction `transferInactiveCommunityTeamCaptains` et la route `/api/cron/team-captain-handover` sont prévues. Route **OFF** par défaut, protégée par `CRON_SECRET`, bloquée sur Preview et, même activée, en mode simulation tant que `TEAM_CAPTAIN_HANDOVER_MODE` n'est pas exactement `execute`. Aucun cron externe n'est configuré.
- Si aucun autre membre actif n'est présent, aucune passation automatique.

## Recette à réaliser sur PostgreSQL fictif

1. Créer une équipe 2 personnes : OK ; tester 1 ou 9 personnes : refus.
2. Faire créer une deuxième équipe au même membre : refus, la première demeure.
3. Faire rejoindre deux équipes simultanément au même joueur : une seule réussit, contrainte de base conservée.
4. Quitter puis tenter de rejoindre immédiatement une autre équipe : refus.
5. Avancer fictivement `lastTeamLeftAt` de 8 jours et retenter : accepté.
6. Rendre un capitaine inactif 31 jours, ajouter deux membres et lancer le traitement en simulation : aucun changement. En mode exécution sur la **base fictive seulement**, le plus ancien devient capitaine. Le deuxième appel est sans effet.
7. Vérifier que l'ancien capitaine conserve ses données historiques, preuves et récompenses.

## Points de relecture Claude avant fusion

- `captainId` est indépendant du créateur historique. Vérifier les autres endroits du code qui présument que `createdById` est toujours le capitaine (éventuels écrans et actions hors `/equipes`).
- Les signaux d'activité ne sont pas équivalents à une connexion. Confirmer la définition de « inactif 30 jours » avant automatisation.
- Vérifier que l'index unique ne rencontre aucun doublon lors de la future migration. La base de production a actuellement zéro équipe selon le dernier audit, mais **contrôler à nouveau** au moment du déploiement.
- Les PR #362 (recherche de jeux) et ce lot modifient `src/app/equipes/page.tsx` ; synchroniser après relecture avant fusion.
- Mettre à jour toutes les documentations utilisateurs et tests sur les codes `already_team` / `cooldown`.

## Migration obligatoire avant merge

Cette PR ajoute `prisma/migrations/20261104140000_tower_team_membership_policy`. Depuis #339, le build n'applique aucune migration : **ne pas merger le code avant application contrôlée de cette migration en Production**.

Ordre obligatoire : précontrôle lecture seule des doublons `(communityId,userId)` → dry-run du runner → accord explicite propriétaire → exécution de la migration → contrôle de fin → merge de la PR.

Le runner `scripts/db-migrate.mjs` n'accepte que `MIGRATION_DATABASE_URL`, une cible attendue explicite et une liste `--expect` exacte. La connexion doit être directe, non poolée, avec un rôle de migration distinct du runtime.

**Interdictions :** aucun test fonctionnel authentifié sur Preview tant que l'isolation Neon et l'interdiction des effets Discord/crons ne sont pas démontrées. Pas de migration de production ni d'activation de la passation sans accord explicite.
