import { prisma } from "@/lib/prisma";

/**
 * Chantier confidentialité des soirées — inventaire EN LECTURE SEULE des
 * annonces/fils Discord PUBLICS déjà envoyés pour une soirée, AVANT ce
 * chantier (chemin bot `announceViaBot: true`, ancienne organisation :
 * annonce dans #🎮-soirées + fil PUBLIC créé dessus). Ne modifie, n'édite
 * ni ne supprime JAMAIS rien côté Discord — sert uniquement à préparer
 * une décision humaine ultérieure sur le traitement de ces messages
 * (aucune opération de nettoyage n'est exécutée par ce chantier, voir le
 * README, section "Anciennes annonces Discord publiques").
 *
 * Limite assumée et documentée : ce module ne peut inventorier QUE ce que
 * la base sait (`NotificationDelivery`, chemin bot). Les annonces émises
 * par le chemin WEBHOOK legacy (`DISCORD_WEBHOOK_URL`) ne laissent AUCUNE
 * trace en base (`postToDiscord` ne persiste jamais l'id du message
 * envoyé) — leur inventaire ne peut se faire que manuellement, en
 * parcourant le salon Discord lui-même. Distingue clairement ce qui est
 * FIABLE (chemin bot, cette liste) de ce qui NE L'EST PAS (chemin
 * webhook, hors de portée de ce module).
 *
 * Fenêtre de fiabilité : à exécuter juste après le déploiement de ce
 * chantier, AVANT qu'une nouvelle session ne déclenche sa propre
 * synchronisation — sans quoi de nouvelles lignes `thread`/`announce`
 * (désormais PRIVÉES par construction) se mêleraient aux anciennes
 * (PUBLIQUES). `sentBefore` permet de fixer explicitement cette borne
 * (l'horodatage réel du déploiement) si l'inventaire est exécuté plus
 * tard.
 */

const LEGACY_PUBLIC_ROLES = new Set(["announce", "thread", "thread-summary"]);

function isLegacyPublicRole(role: string): boolean {
  return LEGACY_PUBLIC_ROLES.has(role) || role.startsWith("thread-reminder-");
}

export interface LegacyPublicAnnounceEntry {
  deliveryId: string;
  sessionId: string;
  /** `null` si la soirée a depuis été supprimée — la ligne de livraison,
   * elle, n'est jamais cascadée (référence libre, voir
   * notification-delivery.ts). */
  sessionStatus: string | null;
  sessionDate: Date | null;
  sessionCreatedById: string | null;
  role: string;
  operation: string;
  sentAt: Date | null;
  discordChannelId: string | null;
  discordMessageId: string | null;
  discordThreadId: string | null;
}

export interface LegacyPublicAnnounceInventory {
  entries: LegacyPublicAnnounceEntry[];
  /** Sessions distinctes concernées — un simple décompte pour l'affichage. */
  sessionCount: number;
}

export async function listLegacyPublicSessionAnnounces(
  options: { sentBefore?: Date } = {}
): Promise<LegacyPublicAnnounceInventory> {
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      status: "SENT",
      targetSlot: { startsWith: "default-guild:SESSION:" },
      ...(options.sentBefore ? { sentAt: { lt: options.sentBefore } } : {}),
    },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      targetSlot: true,
      operation: true,
      sentAt: true,
      discordChannelId: true,
      discordMessageId: true,
      discordThreadId: true,
    },
  });

  const relevant = deliveries
    .map((d) => {
      const parts = d.targetSlot.split(":");
      return { ...d, sessionId: parts[2], role: parts.slice(3).join(":") };
    })
    .filter((d) => isLegacyPublicRole(d.role));

  const sessionIds = [...new Set(relevant.map((d) => d.sessionId))];
  const sessions = await prisma.session.findMany({
    where: { id: { in: sessionIds } },
    select: { id: true, status: true, date: true, createdById: true },
  });
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const entries: LegacyPublicAnnounceEntry[] = relevant.map((d) => {
    const session = sessionById.get(d.sessionId);
    return {
      deliveryId: d.id,
      sessionId: d.sessionId,
      sessionStatus: session?.status ?? null,
      sessionDate: session?.date ?? null,
      sessionCreatedById: session?.createdById ?? null,
      role: d.role,
      operation: d.operation,
      sentAt: d.sentAt,
      discordChannelId: d.discordChannelId,
      discordMessageId: d.discordMessageId,
      discordThreadId: d.discordThreadId,
    };
  });

  return { entries, sessionCount: sessionIds.length };
}
