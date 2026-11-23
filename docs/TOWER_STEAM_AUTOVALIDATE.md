# Validation automatique des défis « mesurables Steam » (`TOWER_STEAM_AUTOVALIDATE_ENABLED`)

OFF par défaut. Migration `20261118130200_tower_challenge_measure` (additive : une enum et des colonnes nullables, aucun défi existant n'est mesuré). Aucune IA : des comparaisons de valeurs renvoyées par l'API Steam officielle.

## Prérequis d'activation
`TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, `STEAM_API_KEY`, `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `CRON_SECRET`. Sans la configuration Discord complète, rien ne démarre (le bouton de doute serait inatteignable). La route `/api/cron/tower-steam-autovalidate` (GET/POST, documentée dans `docs/CRONS.md`) n'est déclenchée par aucun cron créé par le dépôt : cadence externe, 10 minutes conseillées.

## Définitions mesurables
Commande `/tower-admin ajouter-mesure` (ajout au manifeste `scripts/discord-commands.json`, rien n'est enregistré par cette PR) ou `addSoloTowerChallengeDefinition` avec une mesure :
- `temps` : minutes de jeu cumulées sur l'`appid` depuis l'attribution (`GetOwnedGames`, `playtime_forever`, delta depuis un départ relevé à l'attribution) ;
- `succes` : succès débloqués depuis l'attribution (`GetPlayerAchievements`, `unlocktime` postérieur à l'attribution), au total ou un succès nommé.

Seuls les défis **solo** sont mesurables. Un défi mesurable n'est proposé qu'à un joueur dont le compte Steam est lié et qui possède le jeu (jamais « impossible » pour lui), et jamais quand le drapeau est éteint. La mesure est copiée sur la tentative à l'attribution.

## Déroulé
1. Attribution : départ du temps de jeu relevé juste après (bouton « Mon défi »). Si Steam ne répond pas, le cron prend sa première lecture comme départ : le joueur n'est jamais avantagé.
2. Cron : au plus 25 lectures Steam par passage (budget 50 s), une tentative n'est pas relue avant 10 minutes, délai Steam de 6 s par appel. Les tentatives expirées (48 h) ne sont plus lues.
3. Objectif atteint : message public « Validation automatique en attente » dans le salon des preuves (file de notifications) avec le bouton **Signaler un doute**. Les étages ne sont pas encore crédités.
4. **Fenêtre de doute de 6 h** (`TOWER_MEASURE_DOUBT_WINDOW_MS`). Sans doute : le cron crédite les étages (même plafond de 2 réussites par jour que les autres défis ; si le plafond est atteint, le crédit est repris au passage suivant), édite le message (✅) et envoie un **MP au joueur** par la file.
5. Doute : membre actif depuis au moins 3 jours, jamais l'auteur, un seul doute par défi. Le défi redevient une preuve classique : message « Preuve à juger », vote 24 h (3 votants minimum, majorité stricte, règles existantes). Aucun étage n'est retiré : le crédit n'a pas eu lieu.
6. **Profil Steam privé ou compte non lié** : plus de lecture automatique, le joueur dépose une preuve et la communauté vote (le panneau « Mon défi » l'indique).

## Limites
- `playtime_forever` est mis à jour par Steam à la fermeture du jeu, avec retard possible.
- Le message public affiche le résumé de la mesure (minutes ou succès) ; il n'expose que des données Steam déjà publiques pour que la lecture ait réussi.
- Aucun appel Discord direct : `send_channel_message_verified`, `edit_channel_message`, `send_direct_message` via l'executor.
- Indépendant de #465 et du vote par boutons : utilise le vote existant après un doute.
