# The Tower 2.0 — intégration des défis solo/équipe

## Décision de progression

Une réussite d'équipe ajoute le même nombre d'étages **au compteur personnel de chaque participant confirmé** au moment du dépôt de preuve. Le succès ne crée aucun étage d'équipe supplémentaire. Chaque personne consomme un des deux emplacements de réussite récompensée de sa journée à Paris, communs à ses défis solo et d'équipe. Les membres déjà à leur quota gardent une récompense en attente, créditée dès qu'un jour ultérieur leur laisse un emplacement. L'éligibilité est acquise au clic « Je participe » et figée au dépôt de preuve.

## Calendrier

Les saisons restent communautaires et suivent le calendrier standard parisien déjà codé (trimestres du 1er septembre, 1er janvier et 1er avril; intersaison en juillet-août). Le parcours Tower indiquera clairement cette convention; les dates propres à un lycée ne sont pas déductibles de Discord et nécessitent un choix du propriétaire avant personnalisation.

## Plan d'exécution

1. Réconcilier localement #329 sur la base #336 sans modifier les deux branches distantes; contrôler le schéma et les conflits.
2. Ajouter une attribution d'équipe quotidienne idempotente, l'inscription volontaire de participants, la preuve portée par un participant et les votes communautaires. Réutiliser `CommunityTeam` et le cron déjà présent.
3. Unifier le calcul des récompenses solo/équipe, faire respecter atomiquement le plafond quotidien par membre et créditer les récompenses d'équipe différées sans doublon.
4. Étendre l'intégration Discord existante par un parcours d'équipe et mettre à jour l'enregistrement et la documentation des commandes. Aucun envoi de notification réelle.
5. Ajouter une page web `/tower` qui réunit progression, défi courant, saison/classement et liens vers les équipes / parcours existants, sans recréer l'ascension #329.
6. Auditer les bornes de saison et leurs changements d'heure, rendre explicite le calendrier standard et couvrir ses bornes. Ne pas inventer les dates d'un établissement scolaire.
7. Exécuter les validations ciblées disponibles localement, relire les migrations et le diff, puis documenter l'état et les étapes encore dépendantes de déploiement/validation propriétaire.

## Hors périmètre

Pas d'accès ou changement Discord, pas d'attribution de rôle, pas de migration Neon/Production, pas de fusion/push distant, activation ou notification. Les PR #329 et #336 restent séparées pour revue; l'intégration est une branche locale de préparation.
