# Procédure de restauration (essai à blanc)

Objectif : prouver qu'on sait revenir à un état antérieur, avant le lancement. Tout se fait dans la console Neon, à la main. Aucune commande de ce document ne cible la production en écriture.

## Limites à connaître

- Offre gratuite : historique de restauration de 6 h. Passé ce délai, plus de retour possible : la branche de sauvegarde datée est la seule filet.
- Ne jamais supprimer `backup-avant-tower-migrations-20261030`.

## Essai (≈ 15 min)

1. Console Neon → projet GameNight → Branches. Noter l'heure `T0`.
2. Créer une branche depuis `production`, « à l'instant » `T0 − 30 min` (nom : `essai-restauration-AAAAMMJJ`).
3. Se connecter à cette branche en LECTURE SEULE (éditeur SQL de la console) et compter les lignes de références connues :
   `SELECT count(*) FROM "User";` · `SELECT count(*) FROM "Session";`
4. Comparer avec la production à la même heure (`scripts/restore-fingerprint.mjs`, lecture seule, ou les mêmes requêtes) : écart attendu = les écritures des 30 dernières minutes.
5. Noter dans `docs/LANCEMENT_GO.md` (A4) : date, durée, tables comptées, résultat.
6. Supprimer la branche d'essai (jamais la branche de sauvegarde datée).

## Restauration réelle (incident)

1. Couper les écritures : laisser les interrupteurs `*_ENABLED` éteints (Vercel), mettre les jobs cron-job.org en pause.
2. Créer une branche de restauration à l'heure juste avant l'incident.
3. Vérifier ses données (comptages, `restore-fingerprint`).
4. Décider avec Maxime : promouvoir la branche (nouvelle chaîne de connexion dans Vercel, par Maxime) ou copier les lignes utiles.
5. Redéployer, réactiver les jobs, rédiger un court post-mortem.

## Sauvegarde datée avant l'ouverture

Créer une branche `backup-avant-lancement-AAAAMMJJ` depuis `production` la veille de l'ouverture et la conserver au moins 30 jours.
