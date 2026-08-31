"use client";

import { useState } from "react";
import Link from "next/link";
import { buildCalendarHref, type CalendarMode } from "@/lib/calendar-dates";
import { sameUtcDate, toDateInputValue } from "@/lib/wallclock";
import type { CalendarDay } from "@/lib/calendar";

const WEEKDAY_HEADERS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Seuil "bon créneau commun" pour la pastille collectif (validé : 50%). */
const GOOD_SLOT_THRESHOLD = 0.5;

const MONTH_YEAR_FMT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/**
 * Mini-calendrier mensuel compact (pattern Outlook mobile) — remplace
 * l'ancien `MonthGrid` pleine page. Repliable : ouvert par défaut, se
 * replie automatiquement au tap sur une date (laisse la place à la
 * timeline du jour), rouvrable via le chevron. L'état de repli est local
 * (pas dans l'URL) — pure préférence d'affichage du moment, pas une
 * donnée à faire survivre à un partage de lien.
 *
 * Les flèches mois (‹ ›) déplacent la date sélectionnée vers le 1er du
 * mois voisin — la sélection de jour et le mois affiché partagent la même
 * source de vérité (`?date=`), pas besoin d'un état "mois parcouru"
 * séparé. Elles laissent le calendrier ouvert (contrairement au tap sur
 * une date précise) pour pouvoir choisir un jour dans le nouveau mois.
 */
export function MiniMonthCalendar({
  days,
  selectedDate,
  today,
  currentMonth,
  mode,
  totalUsers,
  pote,
  potes,
}: {
  days: CalendarDay[];
  selectedDate: Date;
  today: Date;
  currentMonth: number;
  mode: CalendarMode;
  totalUsers: number;
  pote?: string;
  potes?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const prevMonthDate = new Date(
    Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() - 1, 1)
  );
  const nextMonthDate = new Date(
    Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth() + 1, 1)
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-1">
        <Link
          href={buildCalendarHref({
            date: toDateInputValue(prevMonthDate),
            mode,
            pote,
            potes,
          })}
          aria-label="Mois précédent"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-hover"
        >
          ‹
        </Link>
        <p className="text-sm font-medium capitalize text-foreground">
          {MONTH_YEAR_FMT.format(selectedDate)}
        </p>
        <div className="flex items-center gap-1">
          <Link
            href={buildCalendarHref({
              date: toDateInputValue(nextMonthDate),
              mode,
              pote,
              potes,
            })}
            aria-label="Mois suivant"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-hover"
          >
            ›
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Déplier le mini-calendrier" : "Replier le mini-calendrier"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            {collapsed ? "▼" : "▲"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-1">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted">
            {WEEKDAY_HEADERS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const isCurrentMonth = day.date.getUTCMonth() === currentMonth;
              const isToday = sameUtcDate(day.date, today);
              const isSelected = sameUtcDate(day.date, selectedDate);
              const showPastille =
                mode === "collectif" &&
                totalUsers > 0 &&
                day.maxAvailableCount / totalUsers >= GOOD_SLOT_THRESHOLD;

              return (
                <Link
                  key={day.date.toISOString()}
                  href={buildCalendarHref({
                    date: toDateInputValue(day.date),
                    mode,
                    pote,
                    potes,
                  })}
                  onClick={() => setCollapsed(true)}
                  className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : isToday
                        ? "border border-accent text-accent"
                        : "text-foreground hover:bg-surface-hover"
                  } ${isCurrentMonth ? "" : "opacity-40"}`}
                >
                  <span>{day.date.getUTCDate()}</span>
                  {showPastille && (
                    <span
                      className={`h-1 w-1 rounded-full ${
                        isSelected ? "bg-accent-foreground" : "bg-accent"
                      }`}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
