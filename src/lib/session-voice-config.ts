export type SessionVoiceConfig = {
  guildId: string;
  defaultGuildId?: string;
  channelIds: readonly string[];
  sessionId: string;
  workerId: string;
  generation: number;
};

/** Drapeau maître : éteint, aucune requête ne doit toucher les tables vocales (migrations pas forcément appliquées). */
export function isVoicePresenceEnabled(env: Record<string, string | undefined> = process.env) {
  return env.VOICE_PRESENCE_ENABLED === "true";
}

export function sessionVoiceConfig(env: Record<string, string | undefined>): SessionVoiceConfig | null {
  if (env.VOICE_PRESENCE_ENABLED !== "true") return null;
  const guildId = env.VOICE_PRESENCE_GUILD_ID?.trim() ?? "";
  const sessionId = env.VOICE_PRESENCE_SESSION_ID?.trim() ?? "";
  const workerId = env.VOICE_PRESENCE_WORKER_ID?.trim() ?? "";
  const generation = Number(env.VOICE_PRESENCE_WORKER_GENERATION);
  const channelIds = env.VOICE_PRESENCE_CHANNEL_IDS?.split(",").map(id => id.trim()).filter(Boolean) ?? [];
  if (
    !/^\d{17,20}$/.test(guildId) || !sessionId || !workerId || !Number.isSafeInteger(generation) || generation < 1 ||
    !channelIds.length || channelIds.some(id => !/^\d{17,20}$/.test(id))
  ) {
    throw new Error("Voice presence session configuration incomplete");
  }
  return { guildId, defaultGuildId: env.DISCORD_BOT_GUILD_ID?.trim() ?? "", channelIds, sessionId, workerId, generation };
}
