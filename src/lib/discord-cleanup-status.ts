import { prisma } from "@/lib/prisma";

/**
 * Chantier nettoyage réel du stockage (V2) — expose un état HONNÊTE des
 * suppressions Discord définitives (fil de soirée/tournoi, annonce de
 * tournoi) restées en échec TERMINAL, même quand l'entité métier
 * (`Session`/`Tournament`) elle-même n'existe plus et n'apparaît donc plus
 * dans AUCUNE liste normale du site (`/sessions`, `/tournois`) — sans quoi
 * un nettoyage échoué (permission refusée, réseau) resterait invisible et
 * permanent. Lecture seule : ne déclenche jamais elle-même un appel
 * Discord ni une mutation, voir `retryDiscordCleanupAction`
 * (src/app/admin/nettoyage/actions.ts) pour le réessai.
 *
 * Ne couvre QUE les rôles `thread-delete`/`announce-delete` introduits par
 * ce chantier (suppression manuelle définitive) — jamais `thread-close`
 * (archivage sur annulation, déjà visible normalement puisque le tournoi
 * annulé reste consultable) ni les rôles de livraison "vivants" (annonce/
 * fil d'une entité encore existante), hors périmètre de cette page.
 */

const CLEANUP_ROLES = ["thread-delete", "announce-delete"] as const;
type CleanupRole = (typeof CLEANUP_ROLES)[number];

export interface FailedCleanupDelivery {
  deliveryId: string;
  category: "SESSION" | "TOURNAMENT";
  sourceId: string;
  role: CleanupRole;
  attempts: number;
  errorClass: string | null;
  lastError: string | null;
}

function roleFromTargetSlot(targetSlot: string): CleanupRole | null {
  const parts = targetSlot.split(":");
  const role = parts.slice(3).join(":");
  return (CLEANUP_ROLES as readonly string[]).includes(role) ? (role as CleanupRole) : null;
}

/**
 * Liste les livraisons de nettoyage Discord en échec TERMINAL (`FAILED`,
 * jamais `PENDING`/`RESERVED` — encore en cours de réessai automatique par
 * l'exécuteur, rien à exposer ici) — la DERNIÈRE connue par `targetSlot`
 * (ignore `SKIPPED`, une intention périmée par une plus récente, jamais
 * l'état réel visé — même garde que `getSessionInviteSyncStatuses`,
 * session-announce.ts).
 */
export async function listFailedDiscordCleanupDeliveries(): Promise<FailedCleanupDelivery[]> {
  const rows = await prisma.notificationDelivery.findMany({
    where: {
      operation: "SEND",
      OR: CLEANUP_ROLES.map((role) => ({ targetSlot: { endsWith: `:${role}` } })),
    },
    orderBy: { sequence: "desc" },
    select: {
      id: true,
      targetSlot: true,
      status: true,
      attempts: true,
      errorClass: true,
      lastError: true,
      event: { select: { category: true, sourceId: true } },
    },
  });

  const latestByTargetSlot = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (latestByTargetSlot.has(row.targetSlot) || row.status === "SKIPPED") continue;
    latestByTargetSlot.set(row.targetSlot, row);
  }

  const failed: FailedCleanupDelivery[] = [];
  for (const row of latestByTargetSlot.values()) {
    if (row.status !== "FAILED") continue;
    const role = roleFromTargetSlot(row.targetSlot);
    if (!role) continue;
    if (row.event.category !== "SESSION" && row.event.category !== "TOURNAMENT") continue;
    failed.push({
      deliveryId: row.id,
      category: row.event.category,
      sourceId: row.event.sourceId,
      role,
      attempts: row.attempts,
      errorClass: row.errorClass,
      lastError: row.lastError,
    });
  }
  return failed;
}
