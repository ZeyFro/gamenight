import type { Proposal, Session, Game, User, Vote } from "@prisma/client";
import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY, type PostToDiscordResult } from "@/lib/discord";
import { formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { createNotifications } from "@/lib/notifications";
import { filterByActiveSessionInvite } from "@/lib/session-access";
import { logger } from "@/lib/logger";

export type ProposalWithVotesAndGame = Proposal & {
  game: Game;
  votes: (Vote & { user: User })[];
};

/**
 * Chantier confidentialité des soirées — ce chemin webhook (sessions
 * `announceViaBot: false`) n'a AUCUN mécanisme privé équivalent au fil
 * Discord du chemin bot (`session-announce.ts`) : `DISCORD_WEBHOOK_URL`
 * pointe par construction vers un salon PUBLIC, sans notion de membres.
 * La nouvelle règle de confidentialité ("seuls le créateur et les
 * invités peuvent consulter une soirée... sur le site ET sur Discord")
 * interdit donc catégoriquement de continuer à y publier quoi que ce soit
 * qui décrive une soirée précise — corrigé en supprimant l'appel réseau
 * ET la construction de l'embed lui-même (jamais un simple masquage de
 * contenu envoyé quand même). Les notifications INTERNES
 * (`createNotifications`, visibles uniquement par leur destinataire dans
 * l'app, déjà protégée par `src/lib/session-access.ts`) restent
 * envoyées — ce ne sont jamais des publications publiques — mais
 * restreintes en plus aux invités encore ACTIFS
 * (`filterByActiveSessionInvite`), même garantie que le chemin bot : un
 * retrait doit couper toute NOUVELLE notification, webhook ou bot. Voir
 * le README ("Transition et retour arrière") pour la portée exacte de
 * cette limite (aucune annonce Discord du tout pour une soirée restée
 * sur ce chemin, tant qu'un mécanisme privé dédié n'existe pas pour lui).
 */
function resultPostSkippedByPrivacy(): PostToDiscordResult {
  logger.info(
    "discord-announce",
    "Annonce webhook de résultat de soirée SUPPRIMÉE (confidentialité des soirées — ce salon est public, aucun mécanisme privé pour ce chemin legacy)."
  );
  return { ok: false, error: WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY };
}

/**
 * Poste (historiquement) le résultat de clôture d'une session — voir le
 * commentaire de fonction ci-dessus : le POST Discord public est
 * désormais TOUJOURS supprimé, seules les notifications internes (aux
 * invités actifs uniquement) continuent d'être écrites.
 */
export async function announceSessionResult(
  session: Pick<Session, "id" | "createdById" | "date" | "notifiedUserIds" | "communityId">,
  winner: ProposalWithVotesAndGame | null,
  tie: boolean
): Promise<PostToDiscordResult> {
  void tie; // Ne servait qu'à composer l'embed public, désormais jamais construit.
  if (!winner) {
    return resultPostSkippedByPrivacy();
  }

  const notifiedUserIds = resolveNotifiedUserIds(session.notifiedUserIds);
  const notifiedVotes = winner.votes.filter(
    (v) => !notifiedUserIds || notifiedUserIds.includes(v.user.id)
  );
  const eligibleIds = new Set(
    (
      await filterByActiveSessionInvite(
        session.id,
        session.createdById,
        notifiedVotes.map((v) => v.user)
      )
    ).map((u) => u.id)
  );
  const eligibleVotes = notifiedVotes.filter((v) => eligibleIds.has(v.user.id));

  // Notifications in-app (Sprint 2 PR-C, U3) — mêmes destinataires que
  // les mentions qu'aurait portées l'ancien message Discord, EN PLUS
  // restreintes aux invités encore actifs (voir le commentaire de
  // fonction ci-dessus).
  await createNotifications(
    eligibleVotes.map((v) => ({
      userId: v.user.id,
      communityId: session.communityId,
      type: "SESSION_RESULT" as const,
      title: `🎮 Soirée validée : ${winner.game.name}`,
      message: formatDateTimeFr(session.date),
      relatedSessionId: session.id,
    }))
  );

  return resultPostSkippedByPrivacy();
}
