import Link from "next/link";
import { redirect } from "next/navigation";
import type { Game, Session } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { closeSessionIfDue } from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { createSession } from "./actions";

type SessionRowData = Session & {
  decidedGame: Game | null;
  _count: { proposals: number };
};

function SessionRow({ session }: { session: SessionRowData }) {
  const status = SESSION_STATUS_LABELS[session.status];
  return (
    <Link
      href={`/sessions/${session.id}`}
      className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-zinc-950 capitalize dark:text-zinc-50">
          {formatDateTimeFr(session.date)}
        </p>
        <p className="truncate text-sm text-zinc-500">
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
    </Link>
  );
}

export default async function SessionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

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
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Accueil
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-zinc-950 sm:text-2xl dark:text-zinc-50">
          Soirées
        </h1>
      </div>

      <form
        action={createSession}
        className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-950"
      >
        <h2 className="font-semibold text-zinc-950 dark:text-zinc-50">
          Nouvelle soirée
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500" htmlFor="session-date">
              Date
            </label>
            <input
              id="session-date"
              type="date"
              name="date"
              required
              min={toDateInputValue(todayDateOnly())}
              className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500" htmlFor="session-time">
              Heure
            </label>
            <input
              id="session-time"
              type="time"
              name="time"
              required
              className="rounded-lg border border-zinc-300 px-3 py-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded-full bg-zinc-950 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-800 sm:w-auto sm:text-sm dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Créer la soirée
        </button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          À venir
        </h2>
        {upcoming.length === 0 && (
          <p className="text-sm text-zinc-500">
            Aucune soirée prévue pour l&apos;instant.
          </p>
        )}
        {upcoming.map((session) => (
          <SessionRow key={session.id} session={session} />
        ))}
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            Historique
          </h2>
          {past.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </section>
      )}
    </div>
  );
}
