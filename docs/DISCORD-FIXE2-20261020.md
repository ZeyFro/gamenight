# Discord et offres gratuites — vérification isolée du 20 octobre 2026

Base : `main` à `3e0731b`, branche `codex/fixe2-discord-20261020`.

**230/230 tests ciblés réussis dans 19 fichiers, aucun test ignoré.** Aucun appel Discord réel, accès Production/Neon, secret lu, changement de configuration ni cron distant. Dépendances existantes réutilisées par junction, sans installation ni `prisma generate`.

## Offres gratuites #299 / #301

Le flux GamerPower interroge séparément Steam et Epic, filtre les jeux actifs et exclut notamment clés, essais, DLC, démos et week-ends gratuits. Seules les redirections HTTPS depuis `/open/…` GamerPower vers les boutiques officielles sont admises ; identifiants, port et hôtes ressemblants sont refusés. Les liens produits sont normalisés en français. Cela ne prouve pas la disponibilité commerciale ou régionale réelle sur la boutique.

Un défaut est reproduit : une réponse Steam redirigeant vers Epic produit un identifiant Epic, alors que sa présence active est enregistrée côté Steam. L'annonce peut ainsi être mise en file puis immédiatement refusée comme expirée. Le correctif rejette une destination différente de la plateforme interrogée. Deux fixtures Steam→Epic et Epic→Steam échouent avant le correctif puis passent après ; les offres cohérentes restent couvertes.

Le cache est renouvelé après 900 secondes ; un snapshot n'est accepté que s'il date d'au plus 30 minutes, n'est ni futur ni invalide. Avant l'envoi, une offre absente d'une réponse fraîche valide est expirée. Une source indisponible ou un snapshot trop ancien donne `configuration_unavailable` : l'executor programme une reprise après **2 minutes** et rembourse la tentative. Ce délai est une date d'éligibilité ; la reprise effective dépend du prochain passage de l'executor. Une offre peut donc rester considérée active durant la fenêtre du cache, sans contrôle direct du prix en boutique.

Le catalogue déduplique les produits manuels/automatiques par application Steam ou URL produit ; le manuel est prioritaire. Les annonces Discord utilisent une intention stable par offre GamerPower et communauté, puis une livraison incluant le salon dans sa clé. Deux identifiants GamerPower distincts visant le même produit peuvent donc générer deux annonces. Les garanties SQL de concurrence/idempotence ont été relues, sans test PostgreSQL dans cette mission.

## Configuration proposée, non appliquée

Aucune validation explicite du serveur **GameNight** et du salon **#jeux-gratuits** n'a été trouvée dans les instructions reçues ou les documents locaux consultés. `docs/MISSION-20261019.md` présente toujours cette destination comme une proposition non appliquée. Existence, identifiants, permissions, flags effectifs et cron restent non vérifiés. Aucun identifiant n'est inventé ; les autres communautés restent hors du pilote proposé.

Dans `/admin`, onglet **Communautés**, choisir la communauté GameNight et vérifier son serveur Discord exact. Elle doit être `ACTIVE`. Le contrôle **Jeux gratuits en français** règle `Community.freeGamesEnabled=true`. Le choix **Salon des jeux gratuits** enregistre `CommunityChannelConfig.category=FREE_GAMES`, `enabled=true` et `discordChannelId` du salon confirmé. `Community.discordGuildId` doit correspondre au serveur confirmé ; `DISCORD_BOT_GUILD_ID` n'est qu'un repli pour `default`. Il n'existe pas de variable `DISCORD_BOT_FREE_GAME_CHANNEL_ID` : la destination gratuite vient de la configuration communautaire.

| Nom du réglage | Valeur à préparer après validation |
| --- | --- |
| `FREE_GAME_FEED_ENABLED` | `true` |
| `COMMUNITY_CHANNELS_ENABLED` | `true` |
| `NOTIFICATION_EXECUTOR_ENABLED` | `true` |
| `DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED` | `true` |
| `DISCORD_BOT_TOKEN` | Présent côté serveur, valeur hors dépôt |
| `CRON_SECRET` | Présent côté serveur, valeur hors dépôt |
| Permissions du bot dans le salon confirmé | `VIEW_CHANNEL`, `SEND_MESSAGES`, `EMBED_LINKS` |

Deux tâches GET séparées sont nécessaires : `/api/cron/free-game-discord` et `/api/cron/notification-executor`, authentifiées par `Authorization: Bearer <CRON_SECRET>`. Reprendre uniquement après validation la proposition historique #299 : `*/15 0-2,8-23 * * *`, fuseau `Europe/Paris`. Cette expression suspend les passages entre 03:00 et 07:59 ; elle ne garantit donc pas des annonces nocturnes rapides. Une cadence continue `*/15 * * * *` est une autre proposition à faire valider. Le kick `after()` accélère une livraison nouvellement créée ; le cron executor reste nécessaire pour les reprises. Aucune tâche distante n'a été consultée ou créée.

## Rappels, RSVP, liste d'attente et tournois

Pour la demande **veille + 1 h**, le créateur choisit **24h avant** et **1h avant**, et décoche **2h avant** dans le formulaire de soirée. Le formulaire soumet `reminderPreset=1440` et `reminderPreset=60` ; la valeur persistée attendue est `Session.reminderTimings=[1440,60]`. Ce réglage appartient à chaque soirée, pas à l'administration du serveur. Le défaut global reste `[1440,120]` ; aucun changement silencieux du défaut ou des soirées existantes n'est fait. « Veille » signifie ici 24 heures avant, pas une heure fixe le jour précédent.

Le cron `/api/cron/reminders` est à prévoir toutes les 15 minutes avec la même authentification. Le chemin bot exige `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`, une destination SESSION valide et l'executor actif. `DISCORD_DM_SESSION_ENABLED` autorise les nouveaux MP ; les rappels en fil respectent les destinataires et le créateur. Un cron en retard utilise le temps restant réel et élimine les seuils devenus obsolètes au lieu d'envoyer une rafale.

Les réponses Discord passent par `/api/discord/interactions`, une signature contrôlée avec `DISCORD_APP_PUBLIC_KEY` et l'identité `DISCORD_CLIENT_ID`, puis vérifient l'origine du message et l'accès du membre. Les tests isolés couvrent l'ACK privé, les refus de signature/origine, les boutons du message et le transport HTTP simulé. La liste d'attente conserve les confirmés, promeut en FIFO et exclut les membres retirés/désistés ; tests purs et actions avec doubles réussis. Les verrous SQL et la promotion transactionnelle ne sont pas revalidés ici.

Les annonces de tournoi utilisent l'outbox, le flag `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`, la destination TOURNAMENT et, pour les nouveaux MP, `DISCORD_DM_TOURNAMENT_ENABLED`. Les tests RSVP et composants tournoi ont été exécutés ; le cycle complet création/lancement/fin/annulation et édition des annonces exige les tests PostgreSQL dédiés, non exécutés ici.

## Preuves reproductibles

Depuis le worktree, avec les dépendances déjà présentes :

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/gamerpower-free-games.test.ts src/lib/free-game-discord.test.ts src/lib/free-game-offers.test.ts src/lib/free-game-offers.access.test.ts src/lib/community-announce.test.ts src/lib/reminders.test.ts src/lib/reminder-schedule.test.ts src/lib/discord-rsvp-transport.test.ts src/lib/discord-rsvp-interactions.test.ts src/lib/discord-session-rsvp.test.ts src/lib/discord-tournament-rsvp.test.ts src/app/sessions/actions/seats.test.ts
# 12 fichiers, 119 tests réussis
.\node_modules\.bin\vitest.cmd run src/lib/session-seat-plan.test.ts src/lib/tournament-rsvp-components.test.ts src/lib/community-channels.test.ts src/lib/cron-auth.test.ts src/lib/discord-rest.test.ts src/lib/notification-executor-kick.test.ts src/lib/notification-delivery.pure.test.ts
# 7 fichiers, 111 tests réussis
.\node_modules\.bin\eslint.cmd src/lib/gamerpower-free-games.ts src/lib/gamerpower-free-games.test.ts
git diff --check
```

ESLint ciblé et contrôle du diff réussis. Pas de suite globale, build, compilation TypeScript ni PostgreSQL : limites du créneau autorisé. Pas de validation des messages réels ni de la configuration effective. Prochaine étape : revue indépendante du correctif, puis validation humaine du serveur/salon et de la cadence avant toute activation.

Plugins et skills utilisés : Ponytail (correctif minimal), Superpowers `systematic-debugging`, `test-driven-development`, `verification-before-completion` ; règles `CLAUDE.md` ; claude-mem `work_state` pour le suivi. Graphify lu mais aucun graphe local disponible : reconstruction omise pour respecter l'absence d'installation et le périmètre ciblé. Aucun agent enfant.
