# Panneau d'accueil The Tower — préparation

Trois boutons : Trouver des joueurs, Rejoindre une soirée, Commencer l'Ascension. **Ils répondent avec une URL GameNight privée à l'utilisateur**, via le routeur d'interactions signé, plutôt qu'un lien public arbitraire.

`TOWER_ONBOARDING_PANEL_ENABLED=false` par défaut ; `TOWER_DISCORD_WELCOME_CHANNEL_ID` non configuré, à ajouter seulement après accord. Le code de publication est une fonction **non appelée** : aucune commande, route ni cron ne poste le panneau automatiquement. L'installation réelle dans Discord nécessite une décision du propriétaire et une vérification des permissions YAGPDB déjà en place.

Règles : pas de remplacement de YAGPDB, pas d'onboarding natif Discord, aucun ping général, pas de message en Preview et aucune suppression des panneaux existants.
