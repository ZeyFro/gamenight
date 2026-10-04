import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";
import { FadeInView } from "@/components/ui/FadeInView";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mon historique");

const PLACEMENT_LABELS: Record<number, string> = {
  1: "🥇 1er",
  2: "🥈 2e",
  3: "🥉 3e",
};

interface HistoryRow {
  id: string;
  gameName: string;
  date: Date;
  placement: number | null;
}

/**
 * Onglet "Historique soirées" — sessions où le user a participé, au sens
 * unifié du chantier XP (a voté pour la proposition gagnante). Repéré via
 * les `XpEvent` PARTICIPATE (sourceId = sessionId) plutôt qu'un recalcul :
 * c'est exactement la liste déjà créditée à la clôture de chaque session,
 * et `XpEvent` ne dépend d'aucune ligne purgeable (id libre).
 *
 * Chantier nettoyage réel du stockage (V2, suite) — une soirée peut
 * désormais avoir été PURGÉE (7+ jours après sa fin, ligne `Session`
 * supprimée) : pour CHAQUE participation, la ligne est construite depuis
 * la soirée ENCORE VIVANTE si elle existe (source la plus riche — un
 * placement peut être absent même si la soirée existe encore, si les
 * résultats n'ont jamais été saisis), sinon depuis le `SessionResult`
 * DÉNORMALISÉ de cet utilisateur s'il en existe un (résumé durable qui
 * survit à la purge). Une participation SANS soirée vivante ET SANS
 * `SessionResult` (résultats jamais saisis, ligne déjà purgée) disparaît
 * de cette liste — limite honnêtement assumée : il n'existe alors plus
 * AUCUNE trace du jeu/de la date, rien de plus à afficher (voir le
 * README, "Ce qui reste hors périmètre").
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
  const resultBySessionId = new Map(results.filter((r) => r.sessionId).map((r) => [r.sessionId!, r]));

  const rows: HistoryRow[] = sessionIds
    .map((id): HistoryRow | null => {
      const liveSession = sessionById.get(id);
      if (liveSession) {
        return {
          id,
          gameName: liveSession.decidedGame?.name ?? "?",
          date: liveSession.date,
          placement: resultBySessionId.get(id)?.placement ?? null,
        };
      }
      // Soirée purgée — repli sur le résumé durable, s'il existe.
      const result = resultBySessionId.get(id);
      if (!result?.gameName || !result.sessionDate) return null;
      return { id, gameName: result.gameName, date: result.sessionDate, placement: result.placement };
    })
    .filter((row): row is HistoryRow => row !== null);

  if (rows.length === 0) {
    return (
      <FadeInView>
        <Card>
          <p className="text-sm text-muted">Aucune soirée jouée pour l&apos;instant.</p>
        </Card>
      </FadeInView>
    );
  }

  return (
    <Stagger className="flex flex-col gap-3">
      {rows.map((row) => (
        <StaggerItem key={row.id}>
          <Link href={`/sessions/${row.id}`}>
            <Card className="card-glow flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{row.gameName}</p>
                <p className="text-xs text-muted capitalize">{formatDateTimeFr(row.date)}</p>
              </div>
              {row.placement && <Badge tone="accent">{PLACEMENT_LABELS[row.placement]}</Badge>}
            </Card>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
