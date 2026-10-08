import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getCalendarData, type CalendarDay } from "@/lib/calendar";
import { addDays, buildCalendarHref, getMonthGridRange, type CalendarMode } from "@/lib/calendar-dates";
import { parseDateOnly, sameUtcDate, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { EventCalendar } from "@/components/calendar/EventCalendar";
import { AuroraText } from "@/components/magicui/aurora-text";
import { requireCommunityChosen } from "@/lib/community-picker";
import { withCommunityReadContext } from "@/lib/community-read-context";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { PoteFilterDrawer } from "@/components/calendar/PoteFilterDrawer";
import { ColorDot } from "@/components/ColorDot";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Calendrier");

interface CalendrierSearchParams {
  date?: string;
  mode?: string;
  pote?: string;
  potes?: string;
  vue?: string;
}

/**
 * Grille mois/semaine + agenda du jour + timeline éditable conservée.
 * Un chargement borné au mois, jamais une requête par cellule. Dates UTC
 * « horloge murale », paramètres de filtre et de vue partageables dans l'URL.
 */
export default function CalendrierPage(props: { searchParams: Promise<CalendrierSearchParams> }) {
  return withCommunityReadContext(() => CalendrierContent(props));
}

async function CalendrierContent({
  searchParams,
}: {
  searchParams: Promise<CalendrierSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  await requireCommunityChosen(user.id, "/calendrier");

  const sp = await searchParams;
  const mode: CalendarMode = sp.mode === "individuel" ? "individuel" : "collectif";
  const view = sp.vue === "semaine" ? "semaine" : "mois";
  const today = todayDateOnly();
  const parsed = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? parseDateOnly(sp.date) : today;
  const selectedDate = Number.isFinite(parsed.getTime()) && (!sp.date || toDateInputValue(parsed) === sp.date) ? parsed : today;

  const visibleUserIds = sp.potes ? sp.potes.split(",").filter(Boolean) : null;
  const selectedUserId = mode === "individuel" ? (sp.pote ?? user.id) : undefined;
  // Le résumé mensuel et la timeline doivent montrer les mêmes personnes.
  // Le roster complet reste disponible dans le panneau de sélection.
  const availabilityUserIds = mode === "individuel" ? [sp.pote ?? user.id] : visibleUserIds ?? undefined;

  const { start: rangeStart, end: lastWeekStart } = getMonthGridRange(selectedDate);
  const rangeEndExclusive = addDays(lastWeekStart, 7);

  const data = await getCalendarData(
    rangeStart,
    rangeEndExclusive,
    user.id,
    availabilityUserIds
  );
  const availabilityUsers = availabilityUserIds
    ? data.users.filter((member) => availabilityUserIds.includes(member.id))
    : data.users;

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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <p className="gn-eyebrow mb-3">Les bons moments se préparent ici</p>
        <h1 className="text-3xl font-semibold tracking-tight"><AuroraText colors={["#b99aff", "#e3cffc", "#d4ef80"]}>Le calendrier</AuroraText></h1>
        <p className="mt-1 text-sm text-muted">
          Soirées, roulettes et disponibilités de ton serveur, en un coup d’œil.
        </p>
      </div>

      <EventCalendar days={data.days} selectedDate={selectedDate} today={today} mode={mode} pote={sp.pote} potes={sp.potes} view={view} totalUsers={availabilityUsers.length} />
      <div className="gn-calendar-detail" id="disponibilites-du-jour">
        <div className="gn-calendar-filters">
          <p className="gn-eyebrow">Disponibilités du jour</p>
          <SegmentedControl
            groupId="calendrier-mode"
            activeKey={mode}
            options={[
              {
                key: "collectif",
                label: "Collectif",
                href: buildCalendarHref({ date: sp.date, mode: "collectif", potes: sp.potes, vue: view }),
              },
              {
                key: "individuel",
                label: "Individuel",
                href: buildCalendarHref({ date: sp.date, mode: "individuel", vue: view, pote: sp.pote }),
              },
            ]}
          />



          {mode === "collectif" ? (
            <PoteFilterDrawer users={data.users} visibleUserIds={visibleUserIds} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.users.map((u) => (
                <Link
                  key={u.id}
                  href={buildCalendarHref({ mode: "individuel", pote: u.id, date: sp.date, vue: view })}
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
            users={mode === "collectif" ? availabilityUsers : data.users}
            mode={mode}
            selectedUserId={selectedUserId}
            date={selectedDate}
            today={today}
            pote={sp.pote}
            potes={sp.potes}
            view={view}
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
