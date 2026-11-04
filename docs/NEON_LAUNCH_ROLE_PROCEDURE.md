# Neon — lancement avec rôle partagé puis séparation

> Procédure préparatoire uniquement. **Aucune action Neon ou Vercel n'est exécutée par ce document.** Pour le lancement, l'option retenue est l'option B : le rôle PostgreSQL `neondb_owner` peut temporairement être partagé entre runtime et migrations, mais uniquement avec un contournement explicite du runner.

## 1. Règle de lancement : rôle partagé exceptionnel

Le runner refuse par défaut une migration lorsque le rôle de `MIGRATION_DATABASE_URL` est identique au rôle runtime lu dans `DATABASE_URL` ou `GAMENIGHT_RUNTIME_ROLE`.

L'exception de lancement doit être volontaire :

```text
--allow-shared-role
```

Ce drapeau :
- ne change aucune URL et ne crée aucun rôle ;
- ne supprime aucun autre précontrôle ;
- affiche un avertissement explicite « mode dégradé de lancement » ;
- ne doit être utilisé que tant que runtime et migration utilisent provisoirement `neondb_owner`.

Après séparation des rôles, ne plus utiliser ce drapeau.

## 2. Snapshot Neon obligatoire juste avant chaque `--execute`

La vérification est **opérationnelle et manuelle**, pas automatisée par le runner.

Immédiatement avant chaque exécution distante :
1. ouvrir le projet Neon et confirmer la branche Production exacte ;
2. créer un **snapshot frais** de cette branche ;
3. relever sans secret : identifiant/nom du snapshot, branche source et horodatage ;
4. vérifier que l'horodatage correspond bien à la fenêtre de migration en cours ;
5. consigner ces éléments dans le compte rendu de migration ;
6. seulement ensuite lancer le dry-run final, puis éventuellement `--execute`.

Un ancien snapshot, même restaurable, ne satisfait pas cette étape. Si un nouveau `--execute` est nécessaire plus tard, créer un nouveau snapshot frais.

Le runner rappelle cette exigence mais ne contacte pas Neon et ne tente pas de certifier lui-même l'existence du snapshot.

## 3. Commande de lancement — forme attendue

La commande exacte reste déterminée par la liste `--expect`, la base cible et les variables d'environnement de la fenêtre de migration. Avec le rôle partagé temporaire, elle doit inclure simultanément :
- `--execute` ;
- `--confirm-database=<base>` ;
- `--allow-shared-role`.

Tous les autres garde-fous du runner restent applicables : cible attendue, connexion directe non poolée, liste exacte des migrations, absence de migration inachevée et contrôle post-migration.

## 4. Plan post-lancement : séparer runtime et migration

À réaliser **après le lancement**, dans une intervention dédiée ; ne rien créer pendant la préparation actuelle.

Cible :
- un rôle runtime dédié, utilisé par `DATABASE_URL`, avec les seuls droits nécessaires à l'application ;
- un rôle migration dédié, utilisé uniquement dans `MIGRATION_DATABASE_URL`, avec les droits nécessaires aux migrations Prisma ;
- aucun mot de passe commun entre les deux rôles ;
- connexion runtime poolée si l'architecture le prévoit, connexion migration directe non poolée.

Plan :
1. inventorier les privilèges réellement utilisés par l'application ;
2. créer les deux rôles dans une fenêtre séparée ;
3. attribuer les privilèges minimaux et les droits par défaut sur les futurs objets ;
4. tester le runtime avec le rôle runtime sur un environnement isolé ;
5. tester un dry-run de migration avec le rôle migration ;
6. basculer les variables d'environnement ;
7. vérifier l'application, les crons et les migrations ;
8. retirer l'usage runtime de `neondb_owner` et supprimer l'exception `--allow-shared-role` des procédures habituelles.

## 5. Rotation de `neondb_owner` avant ouverture publique

À réaliser avant l'ouverture publique, sans inclure le nouveau mot de passe dans Git, les tickets, Discord ou les logs.

Ordre recommandé :
1. annoncer une courte fenêtre de changement et éviter toute migration simultanée ;
2. créer un snapshot Neon frais de Production ;
3. générer un nouveau mot de passe fort pour `neondb_owner` dans Neon ;
4. copier la nouvelle chaîne de connexion depuis la source officielle Neon sans la publier ;
5. dans Vercel, mettre à jour `DATABASE_URL` pour les environnements qui utilisent réellement Production ; ne pas recopier la valeur dans Preview si Preview doit rester isolée ;
6. si `MIGRATION_DATABASE_URL` utilise encore temporairement `neondb_owner`, la mettre à jour dans le coffre opérateur utilisé pour les migrations, pas dans le runtime ;
7. redéployer/restart uniquement les environnements nécessaires afin qu'ils prennent la nouvelle variable ;
8. vérifier les lectures/écritures applicatives, l'authentification et les routes de santé sans afficher le DSN ;
9. vérifier qu'aucun ancien processus ne continue d'utiliser l'ancien secret ;
10. documenter l'heure de rotation et le résultat, jamais la valeur du mot de passe.

### Retour arrière

Si la nouvelle chaîne est mal saisie ou si le runtime ne se reconnecte pas :
- corriger immédiatement `DATABASE_URL` avec la valeur valide issue de Neon ;
- relancer le déploiement nécessaire ;
- ne pas lancer de migration pendant l'incident ;
- utiliser le snapshot uniquement si un problème de données est constaté : une rotation de mot de passe seule ne nécessite pas de restauration de données.

## 6. Interdictions pendant cette préparation

- ne créer aucun rôle Neon ;
- ne changer aucun mot de passe ;
- ne modifier aucune variable Vercel ;
- ne lancer aucun `--execute` ;
- ne restaurer aucun snapshot ;
- ne fusionner #325 sur la seule base de cette procédure.
