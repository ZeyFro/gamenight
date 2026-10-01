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

/**
 * V2 ("Jouer maintenant") — invitation rapide par MP Discord. Contrairement
 * à SESSION/TOURNAMENT ci-dessus, AUCUN salon n'est nécessaire (un MP ne
 * cible jamais un salon, voir `sendDirectMessage`, discord-rest.ts) : un
 * seul verrou, pas de paire guildId/channelId à valider. `DISCORD_BOT_TOKEN`
 * reste requis globalement (déjà le cas pour tout le chantier bot),
 * jamais revérifié ici spécifiquement (délégué à `discord-rest.ts`).
 */
export function isInstantSessionInviteViaBotEnabled(): boolean {
  return process.env.DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED === "true";
}

/**
 * V2 (MP soirées) — les annonces, changements de date, jeux décidés et
 * rappels d'une soirée bot partent AUSSI en MP à chaque pote concerné, et
 * leur mention disparaît alors du fil (secours : mention dans le fil si le
 * MP échoue définitivement, voir `session-announce.ts`). Ne gouverne QUE la
 * création de nouveaux MP : ceux déjà en file restent traités. Sans effet
 * sans le chemin bot des soirées lui-même (`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`).
 */
export function isSessionDirectMessageEnabled(): boolean {
  return process.env.DISCORD_DM_SESSION_ENABLED === "true";
}

/**
 * V2 (MP tournois) — l'annonce d'ouverture d'un tournoi bot part AUSSI en MP
 * à chaque pote sélectionné et au créateur ; leur mention disparaît de
 * l'annonce du salon (mention de secours dans le fil du tournoi si le MP est
 * fermé). Éteint par défaut ; ne gouverne que la création de nouveaux MP.
 */
export function isTournamentDirectMessageEnabled(): boolean {
  return process.env.DISCORD_DM_TOURNAMENT_ENABLED === "true";
}

/**
 * V2 (MP roulette) — invitation, rappel et (hors chemin bot des soirées)
 * résultat d'une roulette envoyés en MP. Éteint par défaut ; ne gouverne
 * que la création de nouveaux MP.
 */
export function isRouletteDirectMessageEnabled(): boolean {
  return process.env.DISCORD_DM_ROULETTE_ENABLED === "true";
}
