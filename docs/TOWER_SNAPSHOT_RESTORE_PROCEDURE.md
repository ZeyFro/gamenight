# Restauration de contrôle du snapshot Neon — procédure sans exécution

**Snapshot attendu** : `prod-avant-tower-migrations-20261102` du projet GameNight. Sa présence a été vérifiée dans l'audit antérieur ; aucune restauration isolée de ce snapshot n'a été démontrée. La PR #325 reste strictement interdite de fusion sans exercice complet et fenêtre de maintenance.

## Préflight (READ-ONLY)
1. Dans Neon, relever l'ID et l'horodatage exact du snapshot, l'ID de branche source et son état **sans divulguer de DSN**.
2. Confirmer le quota de branches et une destination isolée libre, jamais `production` ni `preview-gamenight` utilisée par des tests.
3. Identifier la procédure Neon **Restore to new branch** correspondant au snapshot, et vérifier dans l'écran de confirmation le nom exact de la nouvelle branche.
4. Préparer des identifiants de connexion de recette distincts ; aucun déploiement Vercel ne doit pointer automatiquement vers cette branche.
5. Prévoir une fenêtre pendant laquelle aucune tâche automatique ne vise la branche restaurée.

## Exercice sous accord distinct (pas lancé ici)
1. Restaurer le snapshot vers une **nouvelle branche isolée**, nom explicite `rehearsal-restore-20261102`. Ne jamais choisir « Restore production ».
2. Lire les métadonnées de la branche et son parent, et la liste des migrations Prisma.
3. Comparer les tables et index attendus au moment du snapshot, évaluer la cohérence référentielle et les volumes par agrégats seulement.
4. Sur une copie strictement isolée, tester la lecture de données et le retour arrière ; ne pas connecter de bot Discord, aucun webhooks ou cron.
5. Conserver un rapport de preuve daté, masquer les données et secrets personnels.
6. Détruire la branche de test **seulement après un accord séparé**.

## Critère de réussite
Le snapshot est restaurable **sans toucher à la production**, le schéma attendu est cohérent et le retour arrière est documenté. Une simple existence de snapshot n'est pas une preuve suffisante.

**Aucune restauration, migration, création ou suppression Neon exécutée.**