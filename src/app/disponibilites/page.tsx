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
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ActionForm } from "@/components/ActionForm";
import { Stagger, StaggerItem, PopIn } from "@/components/motion";

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
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Mes disponibilités
        </h1>
        <p className="mt-1 text-sm text-muted">
          Règle ton planning une fois — il sert ensuite à savoir qui est
          dispo pour chaque proposition de soirée.
        </p>
      </div>

      <Card className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            📅 Vue calendrier collective
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Visualise les dispos de tout le groupe, les sessions et les
            votes en cours sur une même vue.
          </p>
        </div>
        <ButtonLink href="/calendrier" variant="secondary" size="sm" fullWidthOnMobile className="shrink-0">
          Voir le calendrier
        </ButtonLink>
      </Card>

      <Stagger className="flex flex-col gap-3">
        {DAY_LABELS_MON_FIRST.map(({ dayOfWeek, label }) => {
          const slotsForDay = weeklySlots.filter(
            (s) => s.dayOfWeek === dayOfWeek
          );
          return (
            <StaggerItem key={dayOfWeek}>
              <Card className="flex flex-col gap-3 p-4 sm:p-4">
                <h3 className="font-semibold text-foreground">{label}</h3>

                <div className="flex flex-wrap gap-2">
                  {slotsForDay.length === 0 && (
                    <p className="text-sm text-muted">Aucun créneau</p>
                  )}
                  {slotsForDay.map((slot) => (
                    <PopIn key={slot.id}>
                      <form
                        action={removeWeeklySlot}
                        className="flex items-center gap-1 rounded-full bg-accent/10 py-1.5 pl-3 pr-1.5 text-sm text-foreground"
                      >
                        <span>
                          {slot.startTime}–{slot.endTime}
                        </span>
                        <input type="hidden" name="id" value={slot.id} />
                        <button
                          type="submit"
                          aria-label={`Retirer le créneau ${slot.startTime}-${slot.endTime} du ${label.toLowerCase()}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                        >
                          ×
                        </button>
                      </form>
                    </PopIn>
                  ))}
                </div>

                <ActionForm
                  action={addWeeklySlot}
                  successMessage="Dispo sauvegardée"
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs text-muted">Début</label>
                    <input
                      type="time"
                      name="startTime"
                      required
                      className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs text-muted">Fin</label>
                    <input
                      type="time"
                      name="endTime"
                      required
                      className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                    />
                  </div>
                  <Button type="submit" size="sm" className="shrink-0">
                    + Ajouter
                  </Button>
                </ActionForm>

                <ActionForm
                  action={addWeeklySlot}
                  successMessage="Dispo sauvegardée"
                >
                  <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
                  <input type="hidden" name="startTime" value="20:00" />
                  <input type="hidden" name="endTime" value="00:00" />
                  <button
                    type="submit"
                    className="text-sm text-muted underline underline-offset-2 hover:text-foreground"
                  >
                    + Dispo en soirée (20h–00h) en un clic
                  </button>
                </ActionForm>
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Exceptions ponctuelles
          </h2>
          <p className="mt-1 text-sm text-muted">
            Pour une date précise, indépendamment de ton planning habituel
            (« pas dispo mardi finalement », « exceptionnellement dispo
            dimanche »).
          </p>
        </div>

        <Card>
          <ActionForm
            action={upsertOverride}
            successMessage="Exception enregistrée"
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="override-date">
                Date
              </label>
              <input
                id="override-date"
                type="date"
                name="date"
                required
                min={toDateInputValue(todayDateOnly())}
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-muted"
                htmlFor="override-available"
              >
                Statut
              </label>
              <select
                id="override-available"
                name="available"
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
              >
                <option value="true">Exceptionnellement dispo</option>
                <option value="false">Exceptionnellement PAS dispo</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted" htmlFor="override-start">
                  Début (optionnel)
                </label>
                <input
                  id="override-start"
                  type="time"
                  name="startTime"
                  className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted" htmlFor="override-end">
                  Fin (optionnel)
                </label>
                <input
                  id="override-end"
                  type="time"
                  name="endTime"
                  className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                />
              </div>
            </div>
            <p className="text-xs text-faint">
              Laisse les heures vides pour couvrir toute la journée.
            </p>

            <Button type="submit" variant="primary" fullWidthOnMobile>
              Enregistrer l&apos;exception
            </Button>
          </ActionForm>
        </Card>

        <Stagger className="flex flex-col gap-2">
          {overrides.length === 0 && (
            <p className="text-sm text-muted">Aucune exception à venir.</p>
          )}
          {overrides.map((o) => (
            <StaggerItem key={o.id}>
              <form
                action={removeOverride}
                className="flex items-center justify-between rounded-lg border border-border bg-surface p-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground capitalize">
                    {formatDateFr(o.date)}
                  </p>
                  <p
                    className={
                      o.available
                        ? "text-sm text-accent"
                        : "text-sm text-destructive"
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  ×
                </button>
              </form>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
