import { DAY_LABELS_MON_FIRST, formatDateFr } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

export interface AvailabilityWeeklySlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface AvailabilityOverrideRow {
  id: string;
  date: Date;
  available: boolean;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Vue lecture seule du planning d'un pote (weekly + exceptions à venir)
 * — mêmes données que `/disponibilites`, mais sans aucune action
 * (ajouter/retirer un créneau) : c'est le planning de quelqu'un d'autre.
 */
export function AvailabilityView({
  weeklySlots,
  overrides,
}: {
  weeklySlots: AvailabilityWeeklySlot[];
  overrides: AvailabilityOverrideRow[];
}) {
  const hasAnyWeeklySlot = weeklySlots.length > 0;

  if (!hasAnyWeeklySlot && overrides.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          Aucune disponibilité réglée pour l&apos;instant.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Stagger className="flex flex-col gap-2">
        {DAY_LABELS_MON_FIRST.map(({ dayOfWeek, label }) => {
          const slots = weeklySlots.filter((s) => s.dayOfWeek === dayOfWeek);
          return (
            <StaggerItem key={dayOfWeek}>
              <Card className="flex items-center justify-between gap-3 p-3 sm:p-3">
                <span className="text-sm font-medium text-foreground">
                  {label}
                </span>
                {slots.length === 0 ? (
                  <span className="text-sm text-faint">—</span>
                ) : (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {slots.map((slot) => (
                      <span
                        key={slot.id}
                        className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent"
                      >
                        {slot.startTime}–{slot.endTime}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>

      {overrides.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Exceptions (14 prochains jours)
          </h3>
          <Stagger className="flex flex-col gap-2">
            {overrides.map((o) => (
              <StaggerItem key={o.id}>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground capitalize">
                      {formatDateFr(o.date)}
                    </p>
                    <p className="text-xs text-muted">
                      {o.startTime && o.endTime
                        ? `${o.startTime}–${o.endTime}`
                        : "Toute la journée"}
                    </p>
                  </div>
                  <Badge tone={o.available ? "accent" : "destructive"}>
                    {o.available ? "⭐ exception dispo" : "🚫 exception indispo"}
                  </Badge>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}
    </div>
  );
}
