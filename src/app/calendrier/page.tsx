import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getCalendarData, type CalendarDay } from "@/lib/calendar";
import { addDays, buildCalendarHref, getMonthGridRange, getWeekStart, type CalendarMode } from "@/lib/calendar-dates";
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
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { saveCommunityBirthdayAction, createCommunityDateAction } from "./actions";
import { Button } from "@/components/ui/Button";

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

  const monthRange = getMonthGridRange(selectedDate);
  const rangeStart = view === "semaine" ? getWeekStart(selectedDate) : monthRange.start;
  const rangeEndExclusive = addDays(view === "semaine" ? rangeStart : monthRange.end, 7);

  const data = await getCalendarData(
    rangeStart,
    rangeEndExclusive,
    user.id,
    availabilityUserIds
  );
  const activeCommunityId = await resolveActiveCommunityId(user.id);
  const membership = activeCommunityId ? await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: activeCommunityId, userId: user.id } },
    select: { role: true, status: true },
  }) : null;
  const canShareBirthday = membership?.status === "ACTIVE";
  const canManageCommunityDates = membership?.status === "ACTIVE" && (membership.role === "OWNER" || membership.role === "ADMIN");
  const availabilityUsers = availabilityUserIds
    ? data.users.filter((member) => availabilityUserIds.includes(member.id))
    : data.users;

  const selectedDay: CalendarDay =
    data.days.find((d) => sameUtcDate(d.date, selectedDate)) ??
    ({ date: selectedDate, hours: [], sessions: [], communityDates: [], maxAvailableCount: 0 } satisfies CalendarDay);

  // Édition tactile des dispos (sous-PR 2, étendue post-retour terrain) :
  // on ne peut éditer que SA PROPRE dispo, jamais celle d'un pote —
  // `upsertOverride`/`removeOverrideForDate` opèrent toujours sur
  // `getCurrentUser()`, donc éditer sans ce garde-fou modifierait en
  // silence ta propre dispo tout en affichant celle d'un autre. Autorisé
  // en Collectif (voir tout le monde tout en modifiant la sienne) et en
  // Individuel sur SA PROPRE fiche — jamais en Individuel sur un pote.
  // Requêtes supplémentaires gated : aucun coût en Individuel sur un pote.
  const canEdit = mode === "collectif" || selectedUserId === user.id;
  const ownWeeklySlots = canEdit ? data.ownWeeklySlots : undefined;
  const ownOverrideForDay = canEdit
    ? data.ownOverrides.find((override) => sameUtcDate(override.date, selectedDate)) ?? null
    : undefined;

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <p className="gn-eyebrow mb-3">Les bons moments se préparent ici</p>
        <h1 className="text-3xl font-semibold tracking-tight"><AuroraText colors={["#b99aff", "#e3cffc", "#d4ef80"]}>Le calendrier</AuroraText></h1>
        <p className="mt-1 text-sm text-muted">
          Soirées, roulettes et disponibilités de ton serveur, en un coup d’œil.
        </p>
        <a href="/api/calendrier/export" download className="mt-3 inline-block text-sm text-accent underline">
          Télécharger les soirées à venir (.ics)
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {canShareBirthday && <form action={saveCommunityBirthdayAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
          <div className="min-w-0 flex-1">
            <label className="text-xs text-muted" htmlFor="community-birthday">Partager ton anniversaire avec ce serveur</label>
            <input id="community-birthday" name="date" type="date" required className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
            <p className="mt-1 text-xs text-muted">Seuls le jour et le mois seront conservés. Tu peux le retirer du calendrier.</p>
          </div>
          <Button type="submit" size="sm">Enregistrer</Button>
        </form>}
        {canManageCommunityDates && <form action={createCommunityDateAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
          <div className="min-w-0 flex-1">
            <label className="text-xs text-muted" htmlFor="community-date-title">Date importante du serveur</label>
            <input id="community-date-title" name="title" maxLength={100} required placeholder="Anniversaire du serveur…" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
            <input name="date" aria-label="Date importante" type="date" required defaultValue={toDateInputValue(selectedDate)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted"><input name="annual" type="checkbox" />Chaque année</label>
          <Button type="submit" size="sm">Ajouter</Button>
        </form>}
      </div>

      <EventCalendar days={data.days} selectedDate={selectedDate} today={today} mode={mode} pote={sp.pote} potes={sp.potes} view={view} totalUsers={availabilityUsers.length} viewerId={user.id} canManageCommunityDates={canManageCommunityDates} />
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
