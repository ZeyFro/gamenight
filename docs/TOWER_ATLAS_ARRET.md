# Atlas — audit préalable à l'arrêt des rôles Étage

**État : NON VÉRIFIÉ côté Discord.** Le dépôt GitHub ne donne pas les droits effectifs du bot Atlas ni l'historique complet des attributions. Aucun arrêt n'a été effectué.

## Vérifications en lecture seule
1. Dans **Paramètres du serveur → Rôles**, relever les rôles Étages et leurs permissions, la position du rôle Atlas et ses permissions.
2. Dans le journal d'audit Discord, comparer les changements de rôles Étage aux acteurs (Atlas, autre bot, modérateur). L'absence d'événement récent n'est pas une preuve d'arrêt.
3. Dans les intégrations / commandes d'Atlas, identifier toutes les règles d'attribution automatique et manuelle. Relever les dépendances éventuelles des salons, invitations, événements et rôles de prestige.
4. Vérifier que GameNight ne donne pas lui-même ces mêmes rôles. Le score app et les rôles Discord sont deux sources différentes ; les décisions §26 imposent des rangs calculés **dans l'app uniquement** à ce stade.

## Plan d'arrêt, sous accord
- Photographier/exporter les permissions et dépendances ; conserver une sauvegarde lisible.
- Mettre la génération Atlas en pause, **sans retirer** les rôles existants, puis surveiller une période d'essai avec de vrais membres.
- Après validation du responsable et revue Claude, décider séparément de la conversion ou du retrait des 134 rôles.
- Retour arrière : rétablir les paramètres Atlas sauvegardés ; ne jamais recréer aveuglément 134 rôles.

**Aucune commande Discord ni suppression.**