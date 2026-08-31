import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import {
  addDays,
  getCalendarData,
  getMonthGridRange,
  getWeekStart,
} from "@/lib/calendar";
import { parseDateOnly, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { WeekGrid } from "@/components/calendar/WeekGrid";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { PoteFilterDrawer } from "@/components/calendar/PoteFilterDrawer";
import { ColorDot } from "@/components/ColorDot";

type Vue = "semaine" | "mois";
type Mode = "collectif" | "individuel";

interface CalendrierSearchParams {
  vue?: string;
  date?: string;
  mode?: string;
  pote?: string;
  potes?: string;
}

const SHORT_DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
});
const MONTH_YEAR_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

function buildHref(params: {
  vue: Vue;
  date?: string;
  mode: Mode;
  pote?: string;
  potes?: string;
}): string {
  const search = new URLSearchParams();
  if (params.vue !== "semaine") search.set("vue", params.vue);
  if (params.date) search.set("date", params.date);
  if (params.mode !== "collectif") search.set("mode", params.mode);
  if (params.mode === "individuel" && params.pote) search.set("pote", params.pote);
  if (params.mode === "collectif" && params.potes) search.set("potes", params.potes);
  const qs = search.toString();
  return `/calendrier${qs ? `?${qs}` : ""}`;
}

function tabClass(active: boolean): string {
  return `flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
    active ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
  }`;
}

/**
 * Vue calendrier collectif (PR 4/4, sous-PR 1 — lecture seule). Toute la
 * navigation (vue Semaine/Mois, mode Collectif/Individuel, période
 * affichée, filtre potes) vit dans l'URL — même philosophie que
 * `/classement?periode=` : un rendu serveur simple suffit, pas besoin
 * d'hydrater un composant client pour de la navigation par liens.
 */
export default async function CalendrierPage({
  searchParams,
}: {
  searchParams: Promise<CalendrierSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sp = await searchParams;
  const vue: Vue = sp.vue === "mois" ? "mois" : "semaine";
  const mode: Mode = sp.mode === "individuel" ? "individuel" : "collectif";
  const today = todayDateOnly();
  const anchorDate = sp.date ? parseDateOnly(sp.date) : today;

  const visibleUserIds = sp.potes ? sp.potes.split(",").filter(Boolean) : null;
  const selectedUserId = mode === "individuel" ? (sp.pote ?? user.id) : undefined;

  let rangeStart: Date;
  let rangeEndExclusive: Date;
  let prevAnchor: Date;
  let nextAnchor: Date;
  if (vue === "mois") {
    const { start, end } = getMonthGridRange(anchorDate);
    rangeStart = start;
    rangeEndExclusive = addDays(end, 7);
    prevAnchor = new Date(
      Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() - 1, 1)
    );
    nextAnchor = new Date(
      Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + 1, 1)
    );
  } else {
    rangeStart = getWeekStart(anchorDate);
    rangeEndExclusive = addDays(rangeStart, 7);
    prevAnchor = addDays(rangeStart, -7);
    nextAnchor = addDays(rangeStart, 7);
  }

  const data = await getCalendarData(
    rangeStart,
    rangeEndExclusive,
    mode === "collectif" && visibleUserIds ? visibleUserIds : undefined
  );

  const periodLabel =
    vue === "mois"
      ? MONTH_YEAR_FMT.format(anchorDate)
      : `Semaine du ${SHORT_DATE_FMT.format(rangeStart)} au ${SHORT_DATE_FMT.format(addDays(rangeStart, 6))}`;

  const bestSlotUsers = data.bestSlot
    ? data.users.filter((u) => data.bestSlot!.userIds.includes(u.id))
    : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">📅 Calendrier</h1>
        <p className="mt-1 text-sm text-muted">
          Dispos, sessions et votes en cours, superposés en un seul coup
          d&apos;œil.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 gap-2 rounded-lg border border-border bg-background p-1">
          <Link
            href={buildHref({ vue: "semaine", mode, pote: sp.pote, potes: sp.potes })}
            className={tabClass(vue === "semaine")}
          >
            Semaine
          </Link>
          <Link
            href={buildHref({ vue: "mois", mode, pote: sp.pote, potes: sp.potes })}
            className={tabClass(vue === "mois")}
          >
            Mois
          </Link>
        </div>
        <div className="flex flex-1 gap-2 rounded-lg border border-border bg-background p-1">
          <Link
            href={buildHref({ vue, mode: "collectif", potes: sp.potes })}
            className={tabClass(mode === "collectif")}
          >
            Collectif
          </Link>
          <Link
            href={buildHref({ vue, mode: "individuel", pote: sp.pote })}
            className={tabClass(mode === "individuel")}
          >
            Individuel
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link
          href={buildHref({
            vue,
            mode,
            pote: sp.pote,
            potes: sp.potes,
            date: toDateInputValue(prevAnchor),
          })}
          aria-label="Période précédente"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ‹
        </Link>
        <div className="flex flex-col items-center">
          <p className="text-sm font-medium capitalize text-foreground">{periodLabel}</p>
          <Link
            href={buildHref({ vue, mode, pote: sp.pote, potes: sp.potes })}
            className="text-xs text-accent hover:underline"
          >
            Aujourd&apos;hui
          </Link>
        </div>
        <Link
          href={buildHref({
            vue,
            mode,
            pote: sp.pote,
            potes: sp.potes,
            date: toDateInputValue(nextAnchor),
          })}
          aria-label="Période suivante"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ›
        </Link>
      </div>

      {mode === "collectif" ? (
        <PoteFilterDrawer users={data.users} visibleUserIds={visibleUserIds} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.users.map((u) => (
            <Link
              key={u.id}
              href={buildHref({ vue, mode: "individuel", pote: u.id })}
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

      {mode === "collectif" && data.bestSlot && (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-4">
          <p className="text-sm font-medium text-accent">✨ Meilleur créneau</p>
          <p className="mt-1 text-sm capitalize text-foreground">
            {SHORT_DATE_FMT.format(data.bestSlot.date)} à{" "}
            {String(data.bestSlot.hour).padStart(2, "0")}h — {data.bestSlot.count}/
            {data.users.length} dispo{data.bestSlot.count > 1 ? "s" : ""}
          </p>
          {bestSlotUsers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bestSlotUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-1 text-xs text-foreground"
                >
                  <ColorDot color={u.color} size={8} />
                  {u.discordName}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {vue === "semaine" ? (
        <WeekGrid days={data.days} users={data.users} mode={mode} selectedUserId={selectedUserId} today={today} />
      ) : (
        <MonthGrid
          days={data.days}
          totalUsers={data.users.length}
          currentMonth={anchorDate.getUTCMonth()}
          today={today}
          mode={mode}
          selectedUserId={selectedUserId}
        />
      )}

      <p className="text-center text-xs text-faint">
        Besoin de régler tes créneaux hebdo ou une exception ponctuelle ?{" "}
        <Link href="/disponibilites" className="text-accent hover:underline">
          Configuration détaillée
        </Link>
      </p>
    </div>
  );
}
