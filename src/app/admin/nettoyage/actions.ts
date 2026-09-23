"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { enqueueSessionThreadDelete } from "@/lib/session-announce";
import { enqueueTournamentAnnounceDelete, enqueueTournamentThreadDelete } from "@/lib/tournament-announce";

/**
 * Réessai manuel d'un nettoyage Discord définitif resté en échec terminal
 * (voir `listFailedDiscordCleanupDeliveries`, discord-cleanup-status.ts) —
 * réservé aux admins (l'entité métier elle-même n'existe plus, donc aucune
 * garde "créateur" n'est possible ici). Ré-enqueue simplement une NOUVELLE
 * intention sur le même `targetSlot` (occurrence aléatoire, voir le
 * commentaire des fonctions `enqueue*`) — la convergence
 * `[targetSlot, operation]` garantit qu'elle seule sera traitée. Jamais un
 * appel Discord réel ici (uniquement une écriture, traitée plus tard par
 * l'exécuteur).
 */
export async function retryDiscordCleanupAction(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return;
  if (!checkRateLimit(admin.id, "retryDiscordCleanup")) return;

  const category = String(formData.get("category") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!sourceId) return;

  if (category === "SESSION" && role === "thread-delete") {
    await enqueueSessionThreadDelete(sourceId);
  } else if (category === "TOURNAMENT" && role === "thread-delete") {
    await enqueueTournamentThreadDelete(sourceId);
  } else if (category === "TOURNAMENT" && role === "announce-delete") {
    await enqueueTournamentAnnounceDelete(sourceId);
  } else {
    return;
  }

  revalidatePath("/admin");
}
