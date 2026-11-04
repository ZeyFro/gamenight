# The Tower — exclusion des comptes de test des votes Production

## Règle

Les comptes de test peuvent utiliser l'application, réclamer un défi et déposer une preuve, mais leurs votes ne comptent jamais en Production.

Sont bloqués :
- vote communautaire sur une preuve Tower ;
- vote de fin de saison.

Ne sont pas bloqués par cette règle :
- attribution d'un défi ;
- dépôt d'une preuve ;
- consultation des classements et écrans.

## Configuration

Le contrôle n'est actif que lorsque `VERCEL_ENV=production`.

`melah3` est inclus par défaut dans la liste d'exclusion.

Des comptes supplémentaires peuvent être ajoutés avec :

```text
TOWER_TEST_ACCOUNT_IDENTIFIERS=discordId1,discordId2,NomDeCompteRecette
```

La comparaison d'un nom Discord est insensible à la casse. Les identifiants numériques Discord sont également acceptés.

Le fichier `.env.example` n'est volontairement pas modifié dans cette PR tant que #370 le réserve. Il devra recevoir cette variable avant fusion de ce lot.

## Réponses métier

Les fonctions de vote renvoient `TEST_ACCOUNT_EXCLUDED` sans créer de bulletin.

Cette exclusion est côté serveur : une modification du client ou un clic direct sur un bouton Discord ne peut pas contourner la règle.
