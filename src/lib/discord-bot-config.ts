/**
 * Configuration serveur du chantier annonces Discord bot (salons/fils —
 * après #95/#96/#97/#98). Aucune destination Discord arbitraire ne peut
 * jamais venir d'un formulaire utilisateur : le serveur Discord et le
 * salon #🎮-soirées sont exclusivement des variables d'environnement,
 * lues ici et nulle part ailleurs — voir `.env.example` pour la
 * procédure de configuration (non exécutée par cette PR).
 *
 * Activation par catégorie, désactivée par défaut : sans
 * `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true` (exactement cette valeur)
 * ET une configuration de salon valide, `isSessionAnnounceViaBotEnabled`
 * renvoie `false` — toute nouvelle session continue alors d'utiliser le
 * webhook existant (`discord-announce.ts`/`discord-session-created.ts`/
 * `discord-session-modified.ts`, inchangés). `NOTIFICATION_EXECUTOR_ENABLED`
 * (`src/app/api/cron/notification-executor/route.ts`) reste un
 * interrupteur ENTIÈREMENT SÉPARÉ : même catégorie activée ici, aucune
 * livraison ne part tant que l'exécuteur lui-même n'est pas activé —
 * deux verrous indépendants, jamais un seul suffisant.
 */

export interface SessionAnnounceConfig {
  guildId: string;
  channelId: string;
}

/**
 * `null` si la configuration est absente/incomplète — jamais une valeur
 * partielle exploitable. Lue à chaque appel (pas de cache module-level) :
 * ce module est appelé aussi bien en contexte serveur long-vivant que
 * dans des tests qui `vi.stubEnv` autour d'assertions successives.
 */
export function getSessionAnnounceConfig(): SessionAnnounceConfig | null {
  const guildId = process.env.DISCORD_BOT_GUILD_ID?.trim();
  const channelId = process.env.DISCORD_BOT_SESSION_CHANNEL_ID?.trim();
  if (!guildId || !channelId) return null;
  return { guildId, channelId };
}

/**
 * Vrai uniquement si la catégorie SESSION est explicitement activée ET
 * que la configuration de salon est complète — jamais l'un sans l'autre
 * (un flag activé sans salon configuré ne doit jamais tenter d'écrire
 * vers un salon inexistant/mal identifié).
 */
export function isSessionAnnounceViaBotEnabled(): boolean {
  return process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED === "true" && getSessionAnnounceConfig() !== null;
}

/**
 * Chantier annonces Discord tournois (#🏆-tournois, fil dédié par tournoi)
 * — même contrat que `SessionAnnounceConfig`/`getSessionAnnounceConfig`
 * ci-dessus, salon dédié distinct (`DISCORD_BOT_TOURNAMENT_CHANNEL_ID`),
 * même `DISCORD_BOT_GUILD_ID` partagé (un seul serveur Discord pour toute
 * l'app, cf. spec). Activation par catégorie séparée
 * (`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`) — indépendante de
 * `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` : activer l'une n'active jamais
 * l'autre.
 */
export interface TournamentAnnounceConfig {
  guildId: string;
  channelId: string;
}

export function getTournamentAnnounceConfig(): TournamentAnnounceConfig | null {
  const guildId = process.env.DISCORD_BOT_GUILD_ID?.trim();
  const channelId = process.env.DISCORD_BOT_TOURNAMENT_CHANNEL_ID?.trim();
  if (!guildId || !channelId) return null;
  return { guildId, channelId };
}

export function isTournamentAnnounceViaBotEnabled(): boolean {
  return (
    process.env.DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED === "true" && getTournamentAnnounceConfig() !== null
  );
}
