import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

const PLACEMENT_LABELS: Record<number, string> = {
  1: "🥇 1er",
  2: "🥈 2e",
  3: "🥉 3e",
};

/**
 * Onglet "Historique soirées" — sessions où le user a participé, au sens
 * unifié du chantier XP (a voté pour la proposition gagnante). Repéré via
 * les `XpEvent` PARTICIPATE (sourceId = sessionId) plutôt qu'un recalcul :
 * c'est exactement la liste déjà créditée à la clôture de chaque session.
 */
export default async function ProfilHistoriquePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const participations = await prisma.xpEvent.findMany({
    where: { userId: user.id, reason: "PARTICIPATE" },
    orderBy: { createdAt: "desc" },
  });
  const sessionIds = participations.map((p) => p.sourceId);

  const [sessions, results] = await Promise.all([
    prisma.session.findMany({
      where: { id: { in: sessionIds } },
      include: { decidedGame: true },
    }),
    prisma.sessionResult.findMany({
      where: { sessionId: { in: sessionIds }, userId: user.id },
    }),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const placementBySessionId = new Map(results.map((r) => [r.sessionId, r.placement]));

  const rows = sessionIds
    .map((id) => sessionById.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Aucune soirée jouée pour l&apos;instant.</p>
      </Card>
    );
  }

  return (
    <Stagger className="flex flex-col gap-3">
      {rows.map((session) => {
        const placement = placementBySessionId.get(session.id);
        return (
          <StaggerItem key={session.id}>
            <Link href={`/sessions/${session.id}`}>
              <Card className="card-glow flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {session.decidedGame?.name ?? "?"}
                  </p>
                  <p className="text-xs text-muted capitalize">
                    {formatDateTimeFr(session.date)}
                  </p>
                </div>
                {placement && <Badge tone="accent">{PLACEMENT_LABELS[placement]}</Badge>}
              </Card>
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
