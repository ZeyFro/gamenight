# Réponses de Maxime (23/11/2026) : où chacune est appliquée

Le texte des réponses est dans [QUESTIONS_MAXIME.md](QUESTIONS_MAXIME.md) (section « Réponses de Maxime »). Ce tableau dit **où chaque décision est appliquée**, par quelle PR, et ce qui reste à faire. Tenu à jour à chaque fusion.

| Q | Décision | Appliquée par | État |
| --- | --- | --- | --- |
| Q1–Q4 | Rien n'est exclu, tout reste dans la feuille de route **après le lancement** | `QUESTIONS_MAXIME.md` (contradiction « IA / aucune IA pour les preuves » signalée, à trancher après le lancement) | ✅ documenté |
| Q5 | Effacement automatique : une semaine en **simulation**, puis effacement réel | Lot H de [ALLUMAGES.md](ALLUMAGES.md) (`RETENTION_CLEANUP_ENABLED`, `RETENTION_CLEANUP_MODE`) | ⬜ allumage (ChatGPT) |
| Q6 | **Pas de galerie** dans l'app ; lien de la soirée vers le salon Discord 📸・photos-soirées ; `SESSION_VIDEO_ENABLED` éteint | #539 (lien, `DISCORD_PHOTOS_CHANNEL_ID`) | ✅ code fusionné ; ⬜ poser la variable |
| Q7 | Notifications push | [WEB_PUSH_VAPID.md](WEB_PUSH_VAPID.md) (3 clés VAPID posées par ChatGPT) | ⬜ allumage (lot H) |
| Q8 | Temps en vocal **oui**, avec les 4 migrations vocales | `VOICE_PRESENCE_ENABLED`, lot H | ⬜ vérifier que les 4 migrations sont appliquées, puis allumer |
| Q9 | Défi d'équipe quotidien à **18 h** | `TOWER_TEAM_DAILY_ENABLED` + variables GitHub (lot B) | ⬜ allumage |
| Q10 | « **Niveau d'XP** » (pas « Palier ») ; « Étage » réservé à la Tour | #539 | ✅ fusionné |
| Q11–Q12 | Rester en **gratuit**, **alerte avant saturation** Neon/Vercel, plan de migration | [HEBERGEMENT.md](HEBERGEMENT.md) ; alerte : lot Code 9 | ⬜ alerte à coder (exige une clé `NEON_API_KEY` en lecture seule) |
| Q13 | Pages légales : lien `mailto` dont le texte visible est « ZeyFro » | #539 | ✅ fusionné |
| Q14 | Garder MEE6 et YAGPDB, **retirer Atlas** | [PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md) | ⬜ geste Discord (ChatGPT) |
| Q15 | Garder Discord.Me | `PERMISSIONS_BOTS.md` | ✅ rien à faire |
| Q16 | Couper niveaux et monnaie de MEE6 et UnbelievaBoat | `PERMISSIONS_BOTS.md` | ⬜ geste Discord (ChatGPT) |
| Q17–Q19 | MP personnels seulement ; annonces publiques pour les moments marquants ; ping d'un rôle de jeu sur abonnement | Lot Code 5 (notifications) | ⬜ à coder |
| Q20 | Classements : règle actuelle conservée ; **Potes = amis** | **Code 7** : [POTES_AMIS.md](POTES_AMIS.md), `POTES_FRIENDS_ENABLED`, migration `20261123150000_friendships` | ✅ codé (cette PR) ; ⬜ allumage (lot C) |
| Q21 | Fusion maintenant, une par une | File de fusion terminée pour les PR à migration #525 à #530 ; les migrations s'appliquent **automatiquement** à la fusion (sans approbation) | ✅ fait |
