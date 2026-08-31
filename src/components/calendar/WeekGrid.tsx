import { ColorDot } from "@/components/ColorDot";
import { SessionBlock } from "@/components/calendar/SessionBlock";
import { formatDateFr, sameUtcDate } from "@/lib/wallclock";
import type { CalendarDay, CalendarUser } from "@/lib/calendar";

/**
 * Plage horaire affichée pour le strip de disponibilité (PR 4/4, sous-PR
 * 1) — 8h à 2h le lendemain (18 segments). `getCalendarData` calcule bien
 * les 24h de la journée (pour rester une source de vérité complète,
 * réutilisable telle quelle par le mois ou un futur usage), mais
 * afficher les 24h sur un strip mobile étroit (7 jours empilés, pas de
 * scroll horizontal voulu) noierait l'info utile sous des heures creuses
 * (3h-7h) — une app d'organisation de soirées n'en a pas besoin. Choix
 * d'UI assumé, pas une limite de la couche données.
 */
const DISPLAY_HOURS = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1,
];

function formatHour(hour: number): string {
  return `${hour}h`;
}

/**
 * Vue Semaine (défaut) : 7 jours empilés verticalement plutôt qu'une
 * grille 7 colonnes × 24 lignes — mobile-first strict (contrainte de
 * cette PR) : une vraie grille façon Outlook force soit un scroll
 * horizontal sur 7 colonnes étroites, soit des cellules illisibles sur un
 * téléphone. Un strip horizontal de disponibilité par jour (scroll
 * vertical simple pour parcourir la semaine) reste lisible d'un pouce,
 * garde "toute la semaine d'un coup d'œil" (le but de cette page) sans
 * sacrifier le tactile.
 */
export function WeekGrid({
  days,
  users,
  mode,
  selectedUserId,
  today,
}: {
  days: CalendarDay[];
  users: CalendarUser[];
  mode: "collectif" | "individuel";
  selectedUserId?: string;
  today: Date;
}) {
  const totalUsers = users.length;

  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        const isToday = sameUtcDate(day.date, today);
        return (
          <div
            key={day.date.toISOString()}
            className={`flex flex-col gap-2 rounded-xl border p-3 ${
              isToday ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium capitalize text-foreground">
                {formatDateFr(day.date)}
              </p>
              {mode === "collectif" && day.maxAvailableCount > 0 && (
                <span className="shrink-0 text-xs text-muted">
                  jusqu&apos;à {day.maxAvailableCount}/{totalUsers} dispo
                  {day.maxAvailableCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            <div className="flex gap-[2px]">
              {DISPLAY_HOURS.map((hour) => {
                const hourData = day.hours.find((h) => h.hour === hour);
                const availableIds = hourData?.availableUserIds ?? [];
                const isAvailable =
                  mode === "individuel"
                    ? !!selectedUserId && availableIds.includes(selectedUserId)
                    : availableIds.length > 0;
                const intensity =
                  mode === "collectif" && totalUsers > 0
                    ? availableIds.length / totalUsers
                    : isAvailable
                      ? 1
                      : 0;

                return (
                  <div
                    key={hour}
                    title={`${formatHour(hour)} — ${availableIds.length}/${totalUsers} dispo${availableIds.length > 1 ? "s" : ""}`}
                    className="h-6 flex-1 rounded-sm"
                    style={{
                      backgroundColor:
                        intensity > 0
                          ? `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, transparent)`
                          : "var(--surface-hover)",
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-faint">
              <span>{formatHour(DISPLAY_HOURS[0])}</span>
              <span>{formatHour(DISPLAY_HOURS[Math.floor(DISPLAY_HOURS.length / 2)])}</span>
              <span>{formatHour(DISPLAY_HOURS[DISPLAY_HOURS.length - 1])}</span>
            </div>

            {day.sessions.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                {day.sessions.map((session) => (
                  <SessionBlock key={session.id} session={session} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {mode === "collectif" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted">
          {users.map((user) => (
            <span key={user.id} className="flex items-center gap-1.5">
              <ColorDot color={user.color} size={8} />
              {user.discordName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
