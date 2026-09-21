import { logger } from "@/lib/logger";

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
 * Chantier confidentialité des soirées — code d'erreur partagé renvoyé
 * par `announceSessionCreated`/`announceSessionModified`/
 * `announceSessionResult`/`sendSessionReminder` (chemin webhook legacy,
 * `announceViaBot: false`) : ce salon est PUBLIC et n'a aucun mécanisme
 * privé équivalent au fil Discord du chemin bot, donc plus AUCUNE
 * annonce n'y est jamais postée pour une soirée. Distinct d'un échec
 * RÉEL (`DISCORD_WEBHOOK_URL` absente/invalide, Discord indisponible) —
 * les appelants qui décident s'il faut RETENTER (ex. le cron de rappels)
 * doivent traiter CE code précis comme "traité, jamais retenter", pas
 * comme un échec transitoire.
 */
export const WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY = "confidentialite_soirees_webhook_public_desactive";

/**
 * `true` seulement pour un échec RÉEL — jamais pour
 * `WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY` (état attendu, permanent, pas
 * une panne). Sans cette distinction, chaque création/modification/
 * clôture d'une soirée restée sur le chemin webhook afficherait un
 * bandeau "l'envoi Discord a échoué" en permanence — bruit constant pour
 * un état qui n'a rien d'un échec (voir les appelants dans
 * `src/app/sessions/actions/session-lifecycle.ts`/`src/app/roulette/actions.ts`).
 */
export function isRealDiscordFailure(result: PostToDiscordResult): boolean {
  return !result.ok && result.error !== WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY;
}

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
    logger.warn("discord", "DISCORD_WEBHOOK_URL non configurée — message non envoyé.");
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
      logger.error("discord", `Webhook a répondu ${res.status}`, { status: res.status, body });
      return { ok: false, error: "http_error" };
    }

    return { ok: true };
  } catch (error) {
    logger.error("discord", error);
    return { ok: false, error: "network_error" };
  }
}
