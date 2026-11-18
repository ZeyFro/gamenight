# Commande contextuelle « Signaler »

Flag : `DISCORD_REPORT_COMMAND_ENABLED` (OFF par défaut). Migration `20261118131100_moderation_reports` (table `ModerationReport`, additive).

## Fonctionnement

- Clic droit sur un message, Applications, « Signaler » (commande de type 3, déclarée dans `scripts/discord-commands.json`, **rien n'est enregistré automatiquement** : `node scripts/register-tower-guild-commands.mjs` en simulation, puis `--execute` par le propriétaire).
- Réponse privée immédiate (ACK < 3 s). Un membre actif de la communauté du serveur crée une `ModerationReport` : lien du message, extrait borné (500 caractères), auteur, signaleur, nombre de pièces jointes.
- Ticket privé : événement ADMIN `MODERATION_REPORT` + livraison BOT, exécutés par l'executor (`send_channel_message`) dans le salon staff **privé** `DISCORD_REPORT_STAFF_CHANNEL_ID` (embed avec contexte et liens ; `allowedMentions` vide, jamais de ping). Sans ce salon ou sans executor, le signalement reste enregistré (visible dans /admin, sujet O).
- **Aucune sanction automatique** : ni suppression, ni mute, ni ban, ni retrait de rôle. Le staff décide.
- Journalisé : la ligne en base (créée, jamais modifiée sauf `ticketQueuedAt` / `closedAt`) et un log d'identifiants (jamais du contenu).

## Garde-fous

Pas de signalement de son propre message ni d'un message de bot ; un signalement par message et par membre (unicité SQL, double clic sûr) ; 5 signalements par membre et par heure.

## À faire par Maxime

Créer le salon staff privé, renseigner `DISCORD_REPORT_STAFF_CHANNEL_ID`, enregistrer la commande, puis activer le flag.
