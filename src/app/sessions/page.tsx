import Link from "next/link";
import { redirect } from "next/navigation";
import type { Game, Session } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { closeSessionIfDue } from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { createSession } from "./actions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";

type SessionRowData = Session & {
  decidedGame: Game | null;
  _count: { proposals: number };
};

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  deadline_apres_session:
    "La deadline de vote doit être strictement avant l'heure de la session. Choisis une deadline plus tôt.",
};

function SessionRow({ session }: { session: SessionRowData }) {
  const status = SESSION_STATUS_LABELS[session.status];
  return (
    <Link href={`/sessions/${session.id}`}>
      <div className="card-glow flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition-all duration-200">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground capitalize">
            {formatDateTimeFr(session.date)}
          </p>
          <p className="truncate text-sm text-muted">
            {session.decidedGame
              ? session.decidedGame.name
              : `${session._count.proposals} proposition${session._count.proposals === 1 ? "" : "s"}`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
        >
          {status.label}
        </span>
      </div>
    </Link>
  );
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? CREATE_ERROR_MESSAGES[error] : null;

  const dueSessions = await prisma.session.findMany({
    where: { status: "VOTING", date: { lte: new Date() } },
    select: { id: true },
  });
  await Promise.all(dueSessions.map((s) => closeSessionIfDue(s.id)));

  const sessions = await prisma.session.findMany({
    include: { decidedGame: true, _count: { select: { proposals: true } } },
    orderBy: { date: "desc" },
  });

  const upcoming = sessions.filter(
    (s) => s.status === "VOTING" || s.status === "SCHEDULED"
  );
  const past = sessions.filter(
    (s) => s.status === "DONE" || s.status === "CANCELLED"
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Soirées
      </h1>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Card>
        <form action={createSession} className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground">Nouvelle soirée</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="session-date">
                Date
              </label>
              <input
                id="session-date"
                type="date"
                name="date"
                required
                min={toDateInputValue(todayDateOnly())}
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="session-time">
                Heure
              </label>
              <input
                id="session-time"
                type="time"
                name="time"
                required
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted" htmlFor="deadline-offset">
              Deadline de vote
            </label>
            <select
              id="deadline-offset"
              name="deadlineOffset"
              defaultValue="6"
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
            >
              <option value="6">6h avant la session</option>
              <option value="12">12h avant la session</option>
              <option value="24">24h avant la session</option>
              <option value="48">48h avant la session</option>
            </select>
          </div>

          <details className="text-sm text-muted">
            <summary className="cursor-pointer py-1 select-none">
              Choisir une date/heure précise à la place
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted" htmlFor="deadline-date">
                  Date limite
                </label>
                <input
                  id="deadline-date"
                  type="date"
                  name="deadlineDate"
                  className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted" htmlFor="deadline-time">
                  Heure limite
                </label>
                <input
                  id="deadline-time"
                  type="time"
                  name="deadlineTime"
                  className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          </details>

          <Button type="submit" variant="primary" fullWidthOnMobile>
            Créer la soirée
          </Button>
        </form>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">À venir</h2>
        {upcoming.length === 0 && (
          <p className="text-sm text-muted">
            Aucune soirée prévue pour l&apos;instant.
          </p>
        )}
        <Stagger className="flex flex-col gap-3">
          {upcoming.map((session) => (
            <StaggerItem key={session.id}>
              <SessionRow session={session} />
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            Historique
          </h2>
          <Stagger className="flex flex-col gap-3">
            {past.map((session) => (
              <StaggerItem key={session.id}>
                <SessionRow session={session} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}
    </div>
  );
}
