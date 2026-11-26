# Panneau d'accueil The Tower — préparation

Trois boutons : Trouver des joueurs, Rejoindre une soirée, Commencer l'Ascension. **Ils répondent avec une URL GameNight privée à l'utilisateur**, via le routeur d'interactions signé, plutôt qu'un lien public arbitraire.

`TOWER_ONBOARDING_PANEL_ENABLED=false` par défaut ; `TOWER_DISCORD_WELCOME_CHANNEL_ID` non configuré, à ajouter seulement après accord. La publication est exposée par une route POST réservée au propriétaire, avec confirmation textuelle explicite. Avant d'envoyer, elle vérifie le serveur et le type du salon, puis inspecte les 100 derniers messages pour retrouver exactement son propre panneau; si l'historique ne peut pas être lu, l'envoi échoue fermé. Le nonce Discord réduit aussi les doublons de requêtes répétées rapprochées. Aucun cron ni publication automatique. La publication réelle attend la recette et l'action explicite du propriétaire.

Règles : pas de remplacement de YAGPDB, pas d'onboarding natif Discord, aucun ping général, pas de message en Preview et aucune suppression des panneaux existants.
