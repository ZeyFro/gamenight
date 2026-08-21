import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import {
  DAY_LABELS_MON_FIRST,
  formatDateFr,
  todayDateOnly,
  toDateInputValue,
} from "@/lib/wallclock";
import {
  addWeeklySlot,
  removeWeeklySlot,
  removeOverride,
  upsertOverride,
} from "./actions";

export default async function DisponibilitesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [weeklySlots, overrides] = await Promise.all([
    prisma.weeklyAvailability.findMany({
      where: { userId: user.id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.availabilityOverride.findMany({
      where: { userId: user.id, date: { gte: todayDateOnly() } },
      orderBy: { date: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Accueil
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-950 sm:text-2xl dark:text-zinc-50">
          Mes disponibilités
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Règle ton planning une fois — il sert ensuite à savoir qui est
          dispo pour chaque proposition de soirée.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        {DAY_LABELS_MON_FIRST.map(({ dayOfWeek, label }) => {
          const slotsForDay = weeklySlots.filter(
            (s) => s.dayOfWeek === dayOfWeek
          );
          return (
            <div
              key={dayOfWeek}
              className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-950"
            >
              <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">
                {label}
              </h3>

              <div className="flex flex-wrap gap-2">
                {slotsForDay.length === 0 && (
                  <p className="text-sm text-zinc-500">Aucun créneau</p>
                )}
                {slotsForDay.map((slot) => (
                  <form
                    key={slot.id}
                    action={removeWeeklySlot}
                    className="flex items-center gap-1 rounded-full bg-zinc-100 py-1.5 pl-3 pr-1.5 text-sm dark:bg-zinc-900"
                  >
                    <span>
                      {slot.startTime}–{slot.endTime}
                    </span>
                    <input type="hidden" name="id" value={slot.id} />
                    <button
                      type="submit"
                      aria-label={`Retirer le créneau ${slot.startTime}-${slot.endTime} du ${label.toLowerCase()}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    >
                      ×
                    </button>
                  </form>
                ))}
              </div>

              <form
                action={addWeeklySlot}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-zinc-500">Début</label>
                  <input
                    type="time"
                    name="startTime"
                    required
                    className="w-full rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-xs text-zinc-500">Fin</label>
                  <input
                    type="time"
                    name="endTime"
                    required
                    className="w-full rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <button
                  type="submit"
                  className="shrink-0 rounded-lg border border-zinc-300 px-4 py-3 text-base font-medium hover:bg-zinc-100 sm:text-sm dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  + Ajouter
                </button>
              </form>

              <form action={addWeeklySlot}>
                <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
                <input type="hidden" name="startTime" value="20:00" />
                <input type="hidden" name="endTime" value="00:00" />
                <button
                  type="submit"
                  className="text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
                >
                  + Dispo en soirée (20h–00h) en un clic
                </button>
              </form>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Exceptions ponctuelles
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Pour une date précise, indépendamment de ton planning habituel
            (« pas dispo mardi finalement », « exceptionnellement dispo
            dimanche »).
          </p>
        </div>

        <form
          action={upsertOverride}
          className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-950"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500" htmlFor="override-date">
              Date
            </label>
            <input
              id="override-date"
              type="date"
              name="date"
              required
              min={toDateInputValue(todayDateOnly())}
              className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500" htmlFor="override-available">
              Statut
            </label>
            <select
              id="override-available"
              name="available"
              className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="true">Exceptionnellement dispo</option>
              <option value="false">Exceptionnellement PAS dispo</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500" htmlFor="override-start">
                Début (optionnel)
              </label>
              <input
                id="override-start"
                type="time"
                name="startTime"
                className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-zinc-500" htmlFor="override-end">
                Fin (optionnel)
              </label>
              <input
                id="override-end"
                type="time"
                name="endTime"
                className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Laisse les heures vides pour couvrir toute la journée.
          </p>

          <button
            type="submit"
            className="w-full rounded-full bg-zinc-950 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto sm:text-sm dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Enregistrer l&apos;exception
          </button>
        </form>

        <div className="flex flex-col gap-2">
          {overrides.length === 0 && (
            <p className="text-sm text-zinc-500">Aucune exception à venir.</p>
          )}
          {overrides.map((o) => (
            <form
              key={o.id}
              action={removeOverride}
              className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm dark:bg-zinc-950"
            >
              <div>
                <p className="text-sm font-medium text-zinc-950 capitalize dark:text-zinc-50">
                  {formatDateFr(o.date)}
                </p>
                <p
                  className={
                    o.available
                      ? "text-sm text-emerald-700 dark:text-emerald-400"
                      : "text-sm text-red-600 dark:text-red-400"
                  }
                >
                  {o.available ? "Dispo" : "Pas dispo"}
                  {o.startTime && o.endTime
                    ? ` (${o.startTime}–${o.endTime})`
                    : o.available
                      ? " (toute la journée)"
                      : ""}
                </p>
              </div>
              <input type="hidden" name="id" value={o.id} />
              <button
                type="submit"
                aria-label="Supprimer cette exception"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                ×
              </button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
