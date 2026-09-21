import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getCalendarData, type CalendarDay } from "@/lib/calendar";
import { addDays, buildCalendarHref, getMonthGridRange, type CalendarMode } from "@/lib/calendar-dates";
import { parseDateOnly, sameUtcDate, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { MiniMonthCalendar } from "@/components/calendar/MiniMonthCalendar";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { PoteFilterDrawer } from "@/components/calendar/PoteFilterDrawer";
import { ColorDot } from "@/components/ColorDot";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

interface CalendrierSearchParams {
  date?: string;
  mode?: string;
  pote?: string;
  potes?: string;
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
    user.id,
    mode === "collectif" && visibleUserIds ? visibleUserIds : undefined
  );

  const selectedDay: CalendarDay =
    data.days.find((d) => sameUtcDate(d.date, selectedDate)) ??
    ({ date: selectedDate, hours: [], sessions: [], maxAvailableCount: 0 } satisfies CalendarDay);

  // Édition tactile des dispos (sous-PR 2, étendue post-retour terrain) :
  // on ne peut éditer que SA PROPRE dispo, jamais celle d'un pote —
  // `upsertOverride`/`removeOverrideForDate` opèrent toujours sur
  // `getCurrentUser()`, donc éditer sans ce garde-fou modifierait en
  // silence ta propre dispo tout en affichant celle d'un autre. Autorisé
  // en Collectif (voir tout le monde tout en modifiant la sienne) et en
  // Individuel sur SA PROPRE fiche — jamais en Individuel sur un pote.
  // Requêtes supplémentaires gated : aucun coût en Individuel sur un pote.
  const canEdit = mode === "collectif" || selectedUserId === user.id;
  const [ownWeeklySlots, ownOverrideForDay] = canEdit
    ? await Promise.all([
        prisma.weeklyAvailability.findMany({
          where: { userId: user.id },
          select: { dayOfWeek: true, startTime: true, endTime: true },
        }),
        prisma.availabilityOverride.findUnique({
          where: { userId_date: { userId: user.id, date: selectedDate } },
          select: { available: true, startTime: true, endTime: true },
        }),
      ])
    : [undefined, undefined];

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">📅 Calendrier</h1>
        <p className="mt-1 text-sm text-muted">
          Dispos, sessions et votes en cours, superposés en un seul coup
          d&apos;œil.
        </p>
      </div>

      {/* Colonne mini-mois/filtres à gauche, timeline du jour à droite sur
          desktop — sur mobile (< lg), tout reste empilé dans le même
          ordre qu'avant. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[320px_1fr] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          <SegmentedControl
            groupId="calendrier-mode"
            activeKey={mode}
            options={[
              {
                key: "collectif",
                label: "Collectif",
                href: buildCalendarHref({ date: sp.date, mode: "collectif", potes: sp.potes }),
              },
              {
                key: "individuel",
                label: "Individuel",
                href: buildCalendarHref({ date: sp.date, mode: "individuel", pote: sp.pote }),
              },
            ]}
          />

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
        </div>

        <div className="flex flex-col gap-5">
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
            canEdit={canEdit}
            ownWeeklySlots={ownWeeklySlots}
            ownOverrideForDay={ownOverrideForDay}
            ownColor={user.color}
          />

          <p className="text-center text-xs text-faint">
            Besoin de régler tes créneaux hebdo ou une exception ponctuelle ?{" "}
            <Link href="/disponibilites" className="text-accent hover:underline">
              Configuration détaillée
            </Link>
          </p>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}
