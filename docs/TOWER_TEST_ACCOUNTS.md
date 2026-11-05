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

Avant la fusion, renseigner côté serveur la liste des IDs Discord des comptes de test. Aucun ID réel ne doit être publié dans le dépôt.

```text
TOWER_TEST_ACCOUNT_IDENTIFIERS=999999999999999999
```

La valeur ci-dessus est fictive. Seuls les IDs numériques sont acceptés ; les noms affichés ne sont jamais utilisés. Une liste vide n’exclut aucun compte.

## Réponses métier

Les fonctions de vote renvoient `TEST_ACCOUNT_EXCLUDED` sans créer de bulletin.

Cette exclusion est côté serveur : une modification du client ou un clic direct sur un bouton Discord ne peut pas contourner la règle.
