import Link from "next/link";
import { SessionMonthPill } from "@/components/calendar/SessionBlock";
import { sameUtcDate, toDateInputValue } from "@/lib/wallclock";
import type { CalendarDay } from "@/lib/calendar";

const WEEKDAY_HEADERS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/**
 * Vue Mois : grille 7 colonnes classique — contrairement à la vue
 * Semaine, une case ne montre qu'un chiffre + un fond d'intensité (pas de
 * détail horaire), donc 7 colonnes étroites restent lisibles sur mobile
 * (même pattern que les calendriers mois de Google/Apple Calendar).
 * Cliquer un jour renvoie vers la vue Semaine de sa semaine — pas de
 * détail horaire ici, juste un point d'entrée rapide.
 */
export function MonthGrid({
  days,
  totalUsers,
  currentMonth,
  today,
  mode,
  selectedUserId,
}: {
  days: CalendarDay[];
  totalUsers: number;
  /** Mois affiché (0-11) — pour griser les jours des mois voisins qui complètent la grille. */
  currentMonth: number;
  today: Date;
  mode: "collectif" | "individuel";
  selectedUserId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
        {WEEKDAY_HEADERS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const isCurrentMonth = day.date.getUTCMonth() === currentMonth;
          const isToday = sameUtcDate(day.date, today);
          const hourForSelected = selectedUserId
            ? day.hours.some((h) => h.availableUserIds.includes(selectedUserId))
            : false;
          const intensity =
            mode === "collectif" && totalUsers > 0
              ? day.maxAvailableCount / totalUsers
              : hourForSelected
                ? 1
                : 0;

          return (
            <Link
              key={day.date.toISOString()}
              href={`/calendrier?vue=semaine&date=${toDateInputValue(day.date)}`}
              className={`flex min-h-16 flex-col gap-0.5 rounded-md border p-1 text-[10px] transition-colors ${
                isToday ? "border-accent" : "border-border"
              } ${isCurrentMonth ? "" : "opacity-40"}`}
              style={{
                backgroundColor:
                  intensity > 0
                    ? `color-mix(in srgb, var(--accent) ${Math.round(intensity * 60)}%, transparent)`
                    : undefined,
              }}
            >
              <span className="font-medium text-foreground">{day.date.getUTCDate()}</span>
              {day.sessions.slice(0, 2).map((session) => (
                <SessionMonthPill key={session.id} session={session} />
              ))}
              {day.sessions.length > 2 && (
                <span className="text-muted">+{day.sessions.length - 2}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
