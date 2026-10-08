import { prisma } from "@/lib/prisma";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { creationKey } from "@/lib/creation-intent";
import { awardXp } from "@/lib/xp-actions";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { XP_AMOUNTS } from "@/lib/xp";

/** Reprise avant rate limit/validation des dates. Le reçu ne donne aucun droit :
 * le parent et l'appartenance sont relus ; un parent purgé ne renaît pas.
 * Les effets XP/badges idempotents peuvent réparer une interruption postcommit. */
export async function resumeCreation(actorId: string, kind: string, form: FormData): Promise<string | null> {
  const key = creationKey(form.get("creationKey"));
  if (!key) return null;
  const receipt = await prisma.creationIntent.findUnique({ where: { actorId_kind_key: { actorId, kind, key } } });
  if (!receipt) return null;
  const scopedDb = await getScopedPrisma(actorId);
  const row = kind === "SESSION" || kind === "ROULETTE_SESSION"
    ? await scopedDb.session.findUnique({ where: { id: receipt.resourceId } })
    : kind === "ROULETTE" ? await scopedDb.roulette.findUnique({ where: { id: receipt.resourceId } })
    : kind === "TOURNAMENT" ? await scopedDb.tournament.findUnique({ where: { id: receipt.resourceId } })
    : await scopedDb.instantSession.findUnique({ where: { id: receipt.resourceId } });
  if (!row || row.createdById !== actorId) throw new Error("Cette création n’est plus accessible. Aucune nouvelle création n’a été effectuée.");
  if (kind === "SESSION" || kind === "ROULETTE_SESSION") {
    await awardXp(actorId, row.communityId, "CREATE_SESSION", row.id, XP_AMOUNTS.CREATE_SESSION);
    await checkSessionsCreatedBadges(actorId, row.communityId);
  }
  const path = kind === "SESSION" || kind === "ROULETTE_SESSION" ? "sessions" : kind === "ROULETTE" ? "roulette" : kind === "TOURNAMENT" ? "tournois" : "jouer-maintenant";
  return `/${path}/${row.id}`;
}
