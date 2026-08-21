export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  thumbnail?: { url: string };
  fields?: DiscordEmbedField[];
}

export const ACCENT_COLOR = 0x8b5cf6;
export const DESTRUCTIVE_COLOR = 0xef4444;

export type PostToDiscordResult = { ok: true } | { ok: false; error: string };

/**
 * Poste un message dans le salon Discord via `DISCORD_WEBHOOK_URL`. Ne
 * lève jamais d'exception : un échec (webhook absent, invalide, Discord
 * indisponible) est loggué et renvoyé comme résultat, à charge de
 * l'appelant de décider quoi en faire — la clôture d'une session en base
 * ne doit jamais être bloquée par un souci d'envoi Discord.
 */
export async function postToDiscord(
  embed: DiscordEmbed,
  content?: string
): Promise<PostToDiscordResult> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(
      "[discord] DISCORD_WEBHOOK_URL non configurée — message non envoyé."
    );
    return { ok: false, error: "not_configured" };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content || undefined,
        embeds: [embed],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[discord] Webhook a répondu ${res.status}: ${body}`);
      return { ok: false, error: "http_error" };
    }

    return { ok: true };
  } catch (error) {
    console.error("[discord] Échec de l'envoi du webhook", error);
    return { ok: false, error: "network_error" };
  }
}
