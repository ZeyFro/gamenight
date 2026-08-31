import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getCalendarData, type CalendarDay } from "@/lib/calendar";
import { addDays, buildCalendarHref, getMonthGridRange, type CalendarMode } from "@/lib/calendar-dates";
import { parseDateOnly, sameUtcDate, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { MiniMonthCalendar } from "@/components/calendar/MiniMonthCalendar";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { PoteFilterDrawer } from "@/components/calendar/PoteFilterDrawer";
import { ColorDot } from "@/components/ColorDot";

interface CalendrierSearchParams {
  date?: string;
  mode?: string;
  pote?: string;
  potes?: string;
}

function tabClass(active: boolean): string {
  return `flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
    active ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
  }`;
}

/**
 * `/calendrier` — pattern "Outlook mobile" : mini-mois compact en haut
 * (tap une date pour la sélectionner) + timeline verticale de la journée
 * sélectionnée en dessous. Remplace l'ancienne vue Semaine/Mois (grilles
 * pleine page) — refonte suite retour terrain : pas assez lisible sur
 * mobile. Toute la navigation (`?date=`, `?mode=`, `?pote=`, `?potes=`)
 * reste dans l'URL, même philosophie que `/classement?periode=`.
 *
 * Une seule requête `getCalendarData` sur toute la grille du mois affiché
 * (mêmes données consommées par le mini-mois ET par la timeline du jour
 * sélectionné, qui est un simple `find` dedans) — pas de requête séparée
 * par jour.
 */
export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<CalendrierSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const mode: CalendarMode = sp.mode === "individuel" ? "individuel" : "collectif";
  const today = todayDateOnly();
  const selectedDate = sp.date ? parseDateOnly(sp.date) : today;

  const visibleUserIds = sp.potes ? sp.potes.split(",").filter(Boolean) : null;
  const selectedUserId = mode === "individuel" ? (sp.pote ?? user.id) : undefined;

  const { start: rangeStart, end: lastWeekStart } = getMonthGridRange(selectedDate);
  const rangeEndExclusive = addDays(lastWeekStart, 7);

  const data = await getCalendarData(
    rangeStart,
    rangeEndExclusive,
    mode === "collectif" && visibleUserIds ? visibleUserIds : undefined
  );

  const selectedDay: CalendarDay =
    data.days.find((d) => sameUtcDate(d.date, selectedDate)) ??
    ({ date: selectedDate, hours: [], sessions: [], maxAvailableCount: 0 } satisfies CalendarDay);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">📅 Calendrier</h1>
        <p className="mt-1 text-sm text-muted">
          Dispos, sessions et votes en cours, superposés en un seul coup
          d&apos;œil.
        </p>
      </div>

      <div className="flex gap-2 rounded-lg border border-border bg-background p-1">
        <Link
          href={buildCalendarHref({ date: sp.date, mode: "collectif", potes: sp.potes })}
          className={tabClass(mode === "collectif")}
        >
          Collectif
        </Link>
        <Link
          href={buildCalendarHref({ date: sp.date, mode: "individuel", pote: sp.pote })}
          className={tabClass(mode === "individuel")}
        >
          Individuel
        </Link>
      </div>

      <MiniMonthCalendar
        days={data.days}
        selectedDate={selectedDate}
        today={today}
        currentMonth={selectedDate.getUTCMonth()}
        mode={mode}
        totalUsers={data.users.length}
        pote={sp.pote}
        potes={sp.potes}
      />

      {mode === "collectif" ? (
        <PoteFilterDrawer users={data.users} visibleUserIds={visibleUserIds} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.users.map((u) => (
            <Link
              key={u.id}
              href={buildCalendarHref({ mode: "individuel", pote: u.id, date: sp.date })}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selectedUserId === u.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              <ColorDot color={u.color} size={8} />
              {u.id === user.id ? "Toi" : u.discordName}
            </Link>
          ))}
        </div>
      )}

      <DayTimeline
        key={toDateInputValue(selectedDate)}
        day={selectedDay}
        users={data.users}
        mode={mode}
        selectedUserId={selectedUserId}
        date={selectedDate}
        today={today}
        pote={sp.pote}
        potes={sp.potes}
      />

      <p className="text-center text-xs text-faint">
        Besoin de régler tes créneaux hebdo ou une exception ponctuelle ?{" "}
        <Link href="/disponibilites" className="text-accent hover:underline">
          Configuration détaillée
        </Link>
      </p>
    </div>
  );
}
