import { logger } from "@/lib/logger";

/**
 * Archivage immédiat des fils à la fin d'une soirée / d'un tournoi —
 * NOUVEAU drapeau `DISCORD_THREAD_CLOSE_ON_END_ENABLED` (éteint par défaut,
 * actif seulement si la valeur vaut exactement `true`).
 *
 * Ce que ça ajoute : le nettoyage automatique existant
 * (discord-thread-cleanup.ts) archive et verrouille le fil lors d’un passage externe ; avec ce drapeau l’archivage est
 * programmé dès que la soirée / le tournoi passe DONE ou CANCELLED. La
 * suppression 24 h plus tard, les réessais, les échecs Discord et
 * l'idempotence restent portés, inchangés, par le chemin existant (le cron
 * reste le filet de sécurité).
 *
 * Garde-fous : le drapeau ne fait JAMAIS rien tout seul. Il exige aussi
 * `DISCORD_THREAD_CLEANUP_ENABLED=true` et `DISCORD_THREAD_CLEANUP_MODE=execute`
 * (valeurs lues, jamais modifiées) : en dry-run ou nettoyage éteint, aucun
 * fil n'est touché, exactement comme avant.
 *
 * Ce module est volontairement léger (aucun import du nettoyage au
 * chargement, qui crée des dépendances circulaires avec les annonces) : le
 * code d'archivage n'est chargé que si le drapeau est actif.
 */

export const THREAD_CLOSE_ON_END_FLAG = "DISCORD_THREAD_CLOSE_ON_END_ENABLED";

export function isThreadCloseOnEndEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env[THREAD_CLOSE_ON_END_FLAG] === "true" &&
    env.DISCORD_THREAD_CLEANUP_ENABLED === "true" &&
    env.DISCORD_THREAD_CLEANUP_MODE === "execute"
  );
}

/**
 * À appeler APRÈS le commit de la transition vers DONE/CANCELLED, jamais
 * dedans : un échec ici ne doit jamais défaire la clôture d'une soirée. Il
 * est journalisé (jamais avalé en silence) et rattrapé au passage suivant du
 * cron de nettoyage.
 */
export async function closeThreadOnEndSafely(kind: "session" | "tournament", id: string): Promise<void> {
  if (!isThreadCloseOnEndEnabled()) return;
  try {
    const { closeThreadOnEnd } = await import("@/lib/discord-thread-cleanup");
    await closeThreadOnEnd(kind, id);
  } catch (error) {
    logger.error("thread-close-on-end", error, { kind, id });
  }
}
