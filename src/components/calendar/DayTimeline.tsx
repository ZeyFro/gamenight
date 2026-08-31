"use client";

import { useEffect, useRef, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SessionBlock } from "@/components/calendar/SessionBlock";
import { ColorDot } from "@/components/ColorDot";
import { addDays, buildCalendarHref, type CalendarMode } from "@/lib/calendar-dates";
import { formatDateFr, sameUtcDate, toDateInputValue } from "@/lib/wallclock";
import type { CalendarDay, CalendarSession, CalendarUser } from "@/lib/calendar";

const HOURS_OF_DAY = Array.from({ length: 24 }, (_, h) => h);
const AUTO_SCROLL_HOUR = 18;
const SWIPE_MIN_DISTANCE_PX = 50;

function bestHourOfDay(day: CalendarDay): number | null {
  let best: { hour: number; count: number } | null = null;
  for (const h of day.hours) {
    if (!best || h.availableUserIds.length > best.count) {
      best = { hour: h.hour, count: h.availableUserIds.length };
    }
  }
  return best && best.count > 0 ? best.hour : null;
}

/**
 * Timeline verticale d'une journée complète (24h, pas de fenêtre
 * réduite) — remplace l'ancien strip horizontal 18h de `WeekGrid`.
 * Auto-scroll vers ~18h à CHAQUE changement de jour (pas juste au tout
 * premier chargement de la page) : le composant est remonté à chaque
 * navigation (`key={date}` posé par la page), donc un simple
 * `useEffect` sans dépendances suffit à relancer le scroll "au
 * chargement" pour chaque nouvelle journée affichée.
 *
 * Swipe géré en `touchstart`/`touchend` natifs (pas `@dnd-kit/core` : sa
 * mécanique item→zone de dépôt ne colle pas à un balayage horizontal sur
 * une colonne qui doit rester scrollable verticalement) — zéro nouvelle
 * dépendance. On ne `preventDefault` jamais le scroll vertical natif, on
 * se contente de mesurer le geste à la fin et de ne naviguer que s'il est
 * nettement plus horizontal que vertical.
 */
export function DayTimeline({
  day,
  users,
  mode,
  selectedUserId,
  date,
  today,
  pote,
  potes,
}: {
  day: CalendarDay;
  users: CalendarUser[];
  mode: CalendarMode;
  selectedUserId?: string;
  date: Date;
  today: Date;
  pote?: string;
  potes?: string;
}) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const totalUsers = users.length;
  const usersById = new Map(users.map((u) => [u.id, u]));
  const selectedUserColor =
    mode === "individuel" && selectedUserId
      ? (usersById.get(selectedUserId)?.color ?? "var(--accent)")
      : undefined;

  const isToday = sameUtcDate(date, today);
  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);
  const prevHref = buildCalendarHref({ date: toDateInputValue(prevDate), mode, pote, potes });
  const nextHref = buildCalendarHref({ date: toDateInputValue(nextDate), mode, pote, potes });
  const todayHref = buildCalendarHref({ mode, pote, potes });

  const bestHour = mode === "collectif" ? bestHourOfDay(day) : null;

  const sessionsByHour = new Map<number, CalendarSession[]>();
  for (const session of day.sessions) {
    const hour = session.date.getUTCHours();
    const list = sessionsByHour.get(hour) ?? [];
    list.push(session);
    sessionsByHour.set(hour, list);
  }

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);

  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const deltaX = t.clientX - touchStart.current.x;
    const deltaY = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE_PX) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    router.push(deltaX < 0 ? nextHref : prevHref);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={prevHref}
          aria-label="Jour précédent"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ‹
        </Link>
        <div className="flex flex-col items-center">
          <p className="text-sm font-medium capitalize text-foreground">{formatDateFr(date)}</p>
          {!isToday && (
            <Link href={todayHref} className="text-xs text-accent hover:underline">
              Aujourd&apos;hui
            </Link>
          )}
        </div>
        <Link
          href={nextHref}
          aria-label="Jour suivant"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-surface-hover"
        >
          ›
        </Link>
      </div>

      {mode === "collectif" && day.maxAvailableCount === 0 && day.sessions.length === 0 && (
        <p className="text-sm text-muted">Personne n&apos;a indiqué de dispo ce jour-là.</p>
      )}

      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex max-h-[65vh] flex-col overflow-y-auto rounded-xl border border-border bg-surface"
      >
        {HOURS_OF_DAY.map((hour) => {
          const hourData = day.hours.find((h) => h.hour === hour);
          const availableIds = hourData?.availableUserIds ?? [];
          const isAvailable =
            mode === "individuel"
              ? !!selectedUserId && availableIds.includes(selectedUserId)
              : availableIds.length > 0;
          const sessionsAtHour = sessionsByHour.get(hour) ?? [];
          const isBestHour = bestHour === hour;

          // Couleur du bloc (PR propagation User.color) : en individuel,
          // toujours la couleur du pote affiché. En collectif, un seul
          // pote dispo sur ce créneau → sa couleur perso directement
          // (identifie qui est libre d'un coup d'œil) ; 2+ potes → violet
          // accent neutre avec la même rampe d'intensité qu'avant —
          // mélanger plusieurs couleurs perso arbitraires dans une barre
          // de 28px serait illisible sur mobile, l'intensité reste le
          // signal le plus clair pour "combien de monde".
          let blockColor: string | undefined;
          let opacityPercent = 100;
          if (mode === "individuel") {
            if (isAvailable) blockColor = selectedUserColor;
          } else if (availableIds.length === 1) {
            blockColor = usersById.get(availableIds[0])?.color ?? "var(--accent)";
          } else if (availableIds.length > 1) {
            blockColor = "var(--accent)";
            opacityPercent =
              totalUsers > 0 ? Math.round((availableIds.length / totalUsers) * 100) : 100;
          }

          return (
            <div
              key={hour}
              ref={hour === AUTO_SCROLL_HOUR ? highlightRef : undefined}
              className="flex items-start gap-2 border-t border-border/60 px-3 py-1.5 first:border-t-0"
            >
              <span className="w-9 shrink-0 pt-1.5 text-right text-[11px] text-faint">
                {String(hour).padStart(2, "0")}h
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <div
                  title={`${availableIds.length}/${totalUsers} dispo${availableIds.length > 1 ? "s" : ""}`}
                  className={`h-7 rounded-md ${isBestHour ? "ring-2 ring-accent" : ""}`}
                  style={{
                    backgroundColor: blockColor
                      ? `color-mix(in srgb, ${blockColor} ${opacityPercent}%, transparent)`
                      : "var(--surface-hover)",
                  }}
                />
                {sessionsAtHour.map((session) => (
                  <SessionBlock key={session.id} session={session} />
                ))}
              </div>
              {isBestHour && <span className="pt-1.5 text-sm">✨</span>}
            </div>
          );
        })}
      </div>

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
