# Collecteur vocal Discord (préparatoire)

Le noyau `src/lib/discord-voice-gateway.ts` utilise le WebSocket natif de Node, les heartbeats, les séquences Gateway et `RESUME`. Il écoute uniquement `GUILD_VOICE_STATES` avec `GUILDS`; il n'active pas `GUILD_PRESENCES` ni `GUILD_MEMBERS`. La connexion initiale récupère l'URL recommandée auprès de `/gateway/bot`.

La configuration est `VOICE_PRESENCE_ENABLED=false`, `VOICE_PRESENCE_GUILD_ID` et `VOICE_PRESENCE_CHANNEL_IDS` (liste séparée par des virgules), avec le `DISCORD_BOT_TOKEN` existant. Le flag désactivé renvoie une configuration inactive; le flag activé exige une guild et une liste de salons non vides et numériques.

À la première synchronisation, les membres déjà présents commencent à l'heure de l'observation et les intervalles sont marqués `partial`. Une reprise valide rejoue les événements après le dernier numéro de séquence. Une session invalide ou un numéro de séquence inutilisable détruit l'état en mémoire et signale une lacune; aucune durée manquante n'est estimée. Les arrêts SIGINT/SIGTERM ferment la socket et signalent une lacune pour les visites encore ouvertes.

Le collecteur ne persiste rien et ne journalise aucun identifiant. Son callback d'intervalle contient toutefois l'identifiant Discord du membre en mémoire : aucun hôte ne doit le connecter à un stockage ou activer le flag avant décision explicite sur le périmètre, le consentement, la durée de rétention et la suppression. Un hôte persistant est requis; ce code ne démarre pas seul et aucun démarrage réel n'a été effectué. Les tests utilisent une socket synthétique.
