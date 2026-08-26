import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";
import { formatDateFr } from "@/lib/wallclock";

export interface SuperlativeAwardItem {
  id: string;
  categoryIcon: string;
  categoryName: string;
  gameName: string;
  sessionDate: Date;
  voteCount: number;
}

/**
 * Grille des superlatifs gagnés (PR 8/9) — partagée entre `/profil` et
 * `/potes/[id]`, lecture seule dans les deux cas.
 */
export function SuperlativesWonGrid({
  awards,
  emptyMessage,
}: {
  awards: SuperlativeAwardItem[];
  emptyMessage: string;
}) {
  if (awards.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Stagger className="flex flex-col gap-3">
      {awards.map((award) => (
        <StaggerItem key={award.id}>
          <Card className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              {award.categoryIcon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{award.categoryName}</p>
              <p className="text-xs text-muted">
                {award.gameName} · {formatDateFr(award.sessionDate)}
              </p>
            </div>
            <Badge tone="accent">{award.voteCount} voix</Badge>
          </Card>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
