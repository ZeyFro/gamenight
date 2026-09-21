import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY, type PostToDiscordResult } from "@/lib/discord";
import type { Session, User } from "@prisma/client";
import { logger } from "@/lib/logger";

/**
 * Chantier confidentialité des soirées — voir le commentaire de fonction
 * de `announceSessionResult` (discord-announce.ts) pour le raisonnement
 * complet : ce chemin webhook (sessions `announceViaBot: false`) n'a
 * aucun mécanisme privé équivalent, le POST Discord public (ancien
 * créneau barré vs nouveau, mentions des votants) est désormais TOUJOURS
 * supprimé. Contrairement à `announceSessionCreated`/`announceSessionResult`,
 * cette fonction n'écrivait déjà AUCUNE notification interne avant ce
 * chantier (gap préexistant, non lié à la confidentialité — pas élargi
 * ici, resterait un point ouvert séparé si une notification "soirée
 * modifiée" devient un jour souhaitée pour ce chemin).
 */
export async function announceSessionModified(
  session: Pick<Session, "id" | "date" | "votingDeadline">,
  previous: Pick<Session, "date" | "votingDeadline">,
  editor: Pick<User, "id" | "discordId">
): Promise<PostToDiscordResult> {
  void session;
  void previous;
  void editor;
  logger.info(
    "discord-session-modified",
    "Annonce webhook de modification de soirée SUPPRIMÉE (confidentialité des soirées — salon public, aucun mécanisme privé pour ce chemin legacy)."
  );
  return { ok: false, error: WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY };
}
