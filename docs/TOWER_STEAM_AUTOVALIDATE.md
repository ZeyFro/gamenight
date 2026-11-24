# Validation automatique des défis « mesurables Steam » (`TOWER_STEAM_AUTOVALIDATE_ENABLED`)

OFF par défaut. Migration `20261118130200_tower_challenge_measure` (additive : une enum et des colonnes nullables, aucun défi existant n'est mesuré). Aucune IA : des comparaisons de valeurs renvoyées par l'API Steam officielle.

## Prérequis d'activation
`TOWER_CHALLENGES_ENABLED`, `TOWER_DISCORD_ANNOUNCE_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, `STEAM_API_KEY`, `TOWER_DISCORD_GUILD_ID`, `TOWER_DISCORD_CHANNEL_ID`, `CRON_SECRET`. Sans la configuration Discord complète, rien ne démarre (le bouton de doute serait inatteignable). La route `/api/cron/tower-steam-autovalidate` (GET/POST, documentée dans `docs/CRONS.md`) n'est déclenchée par aucun cron créé par le dépôt : cadence externe, 10 minutes conseillées.

## Définitions mesurables
Commande `/tower-admin ajouter-mesure` (ajout au manifeste `scripts/discord-commands.json`, rien n'est enregistré par cette PR) ou `addSoloTowerChallengeDefinition` avec une mesure :
- `temps` : minutes de jeu cumulées sur l'`appid` depuis l'attribution (`GetOwnedGames`, `playtime_forever`, delta depuis un départ relevé à l'attribution), **plafonnées à 2 h par jour** (voir « Plafond de temps de jeu ») ;
- `succes` : succès débloqués depuis l'attribution (`GetPlayerAchievements`, `unlocktime` postérieur à l'attribution), au total ou un succès nommé.

Seuls les défis **solo** sont mesurables. Un défi mesurable n'est proposé qu'à un joueur dont le compte Steam est lié et qui possède le jeu (jamais « impossible » pour lui), et jamais quand le drapeau est éteint. La mesure est copiée sur la tentative à l'attribution.

## Plafond de temps de jeu : 2 h par jour (mesure `temps` seulement)
Le temps de jeu se farme en laissant le jeu ouvert (AFK). Décision de Maxime : « 2 h Steam par jour ». Les défis `succes` ne sont pas concernés.

Règle (fonction pure, `src/lib/tower-steam-measure-rules.ts`, aucune table ni migration) :

`minutes comptées = min(delta réel, TOWER_STEAM_DAILY_CAP_MINUTES × jours)`, avec `TOWER_STEAM_DAILY_CAP_MINUTES = 120` et :

`jours = max(1, min(jours civils Europe/Paris écoulés depuis l'attribution, ceil(temps écoulé / 24 h)))`

- `delta réel` = temps total actuel moins le temps total relevé à l'attribution (déjà lus, jamais négatif) ;
- `jours civils Europe/Paris écoulés` = différence entre la date de Paris du jour et celle de l'attribution (les journées de 23 h et de 25 h du changement d'heure comptent chacune pour un jour) ;
- le second terme (`ceil(écoulé / 24 h)`) n'existe que pour le changement d'heure de printemps, où la date de Paris peut avancer d'un jour de trop pour une même durée réelle. Il garantit que le résultat ne dépasse jamais 2 pendant les 48 h d'un défi ;
- la valeur plafonnée est celle qui est comparée à l'objectif, enregistrée (`measureValue`) et affichée (« x/objectif min »).

Conséquences :
- **Un défi `temps` dont l'objectif dépasse 240 min (2 h × 2 jours) ne peut jamais être atteint automatiquement** pendant ses 48 h : il retombe sur la preuve et le vote (comportement actuel du repli), sans erreur. Un objectif de 240 min n'est atteignable qu'à partir de la deuxième date de Paris après l'attribution ; un objectif de 120 min ou moins peut l'être dès le premier jour.
- Un jeu laissé ouvert 24 h sur 24 ne compte donc que 120 min le premier jour de Paris, au plus 240 min sur toute la durée du défi.

Limites (non résolues par cette règle) :
- Le plafond est un plafond sur un total : Steam ne donne pas le temps jour par jour. Il ne distingue pas un joueur qui joue 2 h de bon cœur d'un jeu laissé ouvert ; il borne seulement ce qu'un jeu laissé ouvert peut rapporter (au plus 240 min en 48 h). Un objectif de 2 h ou moins reste donc atteignable en laissant le jeu ouvert 2 h : le plafond limite l'abus, il ne l'élimine pas ;
- La règle est volontairement prudente : un joueur très régulier peut voir son temps réel (jusqu'à 2 h chaque jour de Paris) compté légèrement en dessous tant que la date de Paris n'a pas changé ; la lecture suivante, après minuit, rouvre 120 min ;
- « Signaler un doute » reste le garde-fou communautaire, inchangé ;
- Un cumul `playtime_forever` n'est mis à jour par Steam qu'à la fermeture du jeu : un jeu laissé ouvert n'apparaît parfois qu'à sa fermeture, la lecture suivante applique alors le plafond au total d'un coup.

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
