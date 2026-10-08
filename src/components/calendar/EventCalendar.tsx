import Link from "next/link";
import type { CalendarDay } from "@/lib/calendar";
import { addDays, buildCalendarHref, getWeekStart, type CalendarMode } from "@/lib/calendar-dates";
import { sameUtcDate, toDateInputValue } from "@/lib/wallclock";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { ButtonLink } from "@/components/ui/Button";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function EventCalendar({ days, selectedDate, today, mode, pote, potes, view, totalUsers }: {
  days: CalendarDay[]; selectedDate: Date; today: Date; mode: CalendarMode;
  pote?: string; potes?: string; view: "mois" | "semaine"; totalUsers: number;
}) {
  const href = (date: Date, vue = view) => buildCalendarHref({ date: toDateInputValue(date), mode, pote, potes, vue });
  const weekStart = getWeekStart(selectedDate);
  const displayed = view === "semaine" ? days.filter((day) => day.date >= weekStart && day.date < addDays(weekStart, 7)) : days;
  const selectedDay = days.find((day) => sameUtcDate(day.date, selectedDate));
  const previous = view === "semaine" ? addDays(selectedDate, -7) : new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 1));
  const next = view === "semaine" ? addDays(selectedDate, 7) : new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() + 1, 1));
  return <section aria-label="Agenda des soirées et roulettes">
    <div className="gn-calendar-toolbar">
      <div className="gn-calendar-nav">
        <Link prefetch={false} href={href(previous)} aria-label={view === "semaine" ? "Semaine précédente" : "Mois précédent"} className="gn-calendar-control">‹</Link>
        <h2>{MONTH.format(selectedDate)}</h2>
        <Link prefetch={false} href={href(next)} aria-label={view === "semaine" ? "Semaine suivante" : "Mois suivant"} className="gn-calendar-control">›</Link>
        <Link prefetch={false} href={href(today)} className="gn-calendar-control text-xs">Aujourd’hui</Link>
      </div>
      <nav className="gn-calendar-views" aria-label="Vue du calendrier">
        <Link prefetch={false} href={href(selectedDate, "mois")} aria-current={view === "mois"}>Mois</Link>
        <Link prefetch={false} href={href(selectedDate, "semaine")} aria-current={view === "semaine"}>Semaine</Link>
      </nav>
    </div>
    <div className="gn-calendar-layout">
      <div className="gn-calendar-surface">
        <div className="gn-calendar-legend"><span><i className="gn-calendar-dot" />Soirée / vote</span><span><i className="gn-calendar-dot roulette" />Roulette pour plus tard</span><span><i className="gn-calendar-dot dispo" />Disponibilités</span></div>
        <div className="gn-calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className={`gn-calendar-grid ${view === "semaine" ? "week" : ""}`}>
          {displayed.map((day) => {
            const selected = sameUtcDate(day.date, selectedDate);
            const label = DAY.format(day.date);
            return <div key={day.date.toISOString()} className={`gn-calendar-day ${selected ? "selected" : ""} ${day.date.getUTCMonth() !== selectedDate.getUTCMonth() ? "outside" : ""}`}>
              <Link prefetch={false} scroll={false} href={href(day.date)} className="gn-calendar-date" aria-label={`Afficher ${label}`} aria-current={sameUtcDate(day.date, today) ? "date" : undefined} aria-pressed={selected}>{day.date.getUTCDate()}</Link>
              <div className="gn-calendar-chips">
                {day.sessions.slice(0, 2).map((session) => <Link prefetch={false} href={`/sessions/${session.id}`} className="gn-calendar-event" key={session.id}><b>{session.decidedGameName ?? "Soirée · vote ouvert"}</b><span>{TIME.format(session.date)}</span></Link>)}
                {day.roulettes?.slice(0, 1).map((roulette) => <Link prefetch={false} href={`/roulette/${roulette.id}`} className="gn-calendar-event roulette" key={roulette.id}><b>Roulette</b><span>{TIME.format(roulette.scheduledAt)}</span></Link>)}
                {(day.sessions.length > 2 || (day.roulettes?.length ?? 0) > 1) && <Link prefetch={false} href={href(day.date)} className="text-[10px] text-muted">Voir la journée →</Link>}
              </div>
              <div className="gn-calendar-mobile-dots" aria-hidden="true">{day.sessions.length > 0 && <i className="gn-calendar-dot" />}{!!day.roulettes?.length && <i className="gn-calendar-dot roulette" />}{day.maxAvailableCount > 0 && <i className="gn-calendar-dot dispo" />}</div>
              {day.maxAvailableCount > 0 && <p className="gn-calendar-availability">{day.maxAvailableCount}/{totalUsers} dispo</p>}
            </div>;
          })}
        </div>
      </div>
      <aside className="gn-calendar-agenda" aria-label="Programme du jour">
        <p className="gn-eyebrow">Au programme</p><h3>{DAY.format(selectedDate)}</h3>
        {selectedDay?.sessions.map((session) => <Link prefetch={false} key={session.id} href={`/sessions/${session.id}`} className="gn-agenda-event">
          <span className="text-xs text-accent">{SESSION_STATUS_LABELS[session.status].label} · {TIME.format(session.date)}</span>
          <h4>{session.decidedGameName ?? "On choisit le jeu ensemble"}</h4>
          <p>{session.decidedGameName ? `${session.players.length} joueur(s) inscrit(s)` : `${session.proposals.length} proposition(s)`}</p>
          <small className="mt-3 block">Ouvrir la soirée →</small>
        </Link>)}
        {selectedDay?.roulettes?.map((roulette) => <Link prefetch={false} key={roulette.id} href={`/roulette/${roulette.id}`} className="gn-agenda-event roulette"><span className="text-xs" style={{ color: "var(--gn-lime)" }}>Roulette · {TIME.format(roulette.scheduledAt)}</span><h4>Le hasard choisira le jeu</h4><p>Propositions jusqu’à {TIME.format(roulette.deadline)}</p><small className="mt-3 block">Ouvrir la roulette →</small></Link>)}
        {!selectedDay?.sessions.length && !selectedDay?.roulettes?.length && <div className="gn-agenda-empty"><span className="mb-3 block text-3xl" aria-hidden="true">☾</span>Une soirée libre.<br />À vous de jouer !</div>}
        <ButtonLink href={`/sessions?date=${toDateInputValue(selectedDate)}`} variant="primary" size="sm" className="w-full">+ Proposer une soirée</ButtonLink>
        <Link prefetch={false} href="/tournois" className="mt-4 block text-xs text-muted">Voir les tournois du serveur →</Link>
      </aside>
    </div>
  </section>;
}
