const API_BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 5_000;
// Discord JSON error code « Unknown Member » : seule preuve de non-appartenance.
const UNKNOWN_MEMBER = 10007;

/**
 * `true` si `discordId` est membre du serveur `guildId`, `false` s'il ne
 * l'est pas à coup sûr (404 + code 10007). TOUT autre résultat (jeton
 * absent, 401/403, 404 « serveur inconnu », 429, 5xx, réseau) LÈVE : un
 * appelant ne doit jamais confondre « je n'ai pas pu vérifier » avec « non
 * membre ». GET /guilds/{guild.id}/members/{user.id}, jeton du bot, sans
 * intent privilégié.
 */
export async function isGuildMember(discordId: string, guildId: string): Promise<boolean> {
  if (!/^\d+$/.test(discordId) || !/^\d+$/.test(guildId)) {
    throw new Error("isGuildMember : identifiant Discord invalide.");
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("isGuildMember : DISCORD_BOT_TOKEN non configurée.");

  const res = await fetch(`${API_BASE}/guilds/${guildId}/members/${discordId}`, {
    method: "GET",
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return true;

  const body = (await res.json().catch(() => null)) as { code?: number } | null;
  if (res.status === 404 && body?.code === UNKNOWN_MEMBER) return false;
  throw new Error(`isGuildMember : Discord a répondu ${res.status} (code ${body?.code ?? "?"}).`);
}
