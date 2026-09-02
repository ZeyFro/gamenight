import Link from "next/link";
import { redirect } from "next/navigation";
import type { Game, Session } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { closeSessionIfDue } from "@/lib/sessions";
import {
  finalizeSuperlativeVotingIfDue,
  getPendingSuperlativeVoteSessionIds,
} from "@/lib/superlative-voting";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import {
  formatDateTimeFr,
  todayDateOnly,
  toDateInputValue,
  wallClockNow,
} from "@/lib/wallclock";
import { createSession } from "./actions";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";
import { ReminderTimingsField } from "@/components/ReminderTimingsField";
import { NotifyRecipientsField } from "@/components/NotifyRecipientsField";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { tagColor } from "@/lib/tags";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";

type SessionParticipant = {
  discordName: string;
  discordAvatar: string | null;
  color: string;
};

type SessionRowData = Session & {
  decidedGame: Game | null;
  _count: { proposals: number };
  proposals: { gameId: string; votes: { userId: string; user: SessionParticipant }[] }[];
};

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  deadline_apres_session:
    "La deadline de vote doit être strictement avant l'heure de la session. Choisis une deadline plus tôt.",
  session_trop_proche:
    "Cette session est trop proche (ou déjà passée) pour laisser un minimum de temps de vote (30 min). Choisis une heure un peu plus tardive.",
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

// Même logique que la home ("joueurs inscrits") : voteurs de la
// proposition gagnante une fois le jeu décidé, sinon l'ensemble des
// voteurs toutes propositions confondues (VOTING).
function getParticipants(session: SessionRowData) {
  const relevantProposals = session.decidedGameId
    ? session.proposals.filter((p) => p.gameId === session.decidedGameId)
    : session.proposals;
  const byUser = new Map<string, SessionParticipant>();
  for (const p of relevantProposals) {
    for (const v of p.votes) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, v.user);
    }
  }
  return [...byUser.entries()].map(([userId, user]) => ({ userId, ...user }));
}

function SessionRow({
  session,
  needsSuperlativeVote,
}: {
  session: SessionRowData;
  needsSuperlativeVote: boolean;
}) {
  const status = SESSION_STATUS_LABELS[session.status];
  const participants = getParticipants(session);
  return (
    <Link href={`/sessions/${session.id}`}>
      <div className="card-glow flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-all duration-200">
        <div className="flex items-center justify-between gap-3">
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
        {participants.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {participants.slice(0, 5).map((p) => (
                <Avatar
                  key={p.userId}
                  src={p.discordAvatar}
                  alt={p.discordName}
                  size={22}
                  className="ring-2 ring-surface"
                />
              ))}
              {participants.length > 5 && (
                <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-hover text-[10px] font-semibold text-muted ring-2 ring-surface">
                  +{participants.length - 5}
                </div>
              )}
            </div>
            <span className="text-xs text-muted">
              {participants.length} joueur{participants.length === 1 ? "" : "s"} inscrit
              {participants.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
        {needsSuperlativeVote && (
          <Badge tone="accent" glow animate className="w-fit">
            🏆 Vote les récompenses !
          </Badge>
        )}
      </div>
    </Link>
  );
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    gameId?: string;
    date?: string;
    time?: string;
    tab?: string;
    cancelled?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const {
    error,
    gameId,
    date: prefillDate,
    time: prefillTime,
    tab,
    cancelled,
  } = await searchParams;
  const errorMessage = error ? CREATE_ERROR_MESSAGES[error] : null;
  const activeTab: "upcoming" | "history" = tab === "history" ? "history" : "upcoming";
  const showCancelled = cancelled === "1";
  const preselectedGame = gameId
    ? await prisma.game.findUnique({ where: { id: gameId } })
    : null;

  const [potesRaw, tags] = await Promise.all([
    prisma.user.findMany({
      where: { id: { not: user.id } },
      select: {
        id: true,
        discordName: true,
        discordAvatar: true,
        color: true,
        userTags: { select: { tagId: true } },
      },
      orderBy: { discordName: "asc" },
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  // Sprint 3 (FEATURE 6) — sélection groupée par tag dans `NotifyRecipientsField`.
  const potes = potesRaw.map((p) => ({ ...p, tagIds: p.userTags.map((t) => t.tagId) }));
  const tagOptions = tags.map((t) => ({ id: t.id, name: t.name, color: tagColor(t.name) }));

  const dueSessions = await prisma.session.findMany({
    where: { status: "VOTING", date: { lte: wallClockNow() } },
    select: { id: true },
  });
  await Promise.all(dueSessions.map((s) => closeSessionIfDue(s.id)));

  const dueSuperlativeVotings = await prisma.session.findMany({
    where: { status: "DONE", superlativeVotingClosed: false },
    select: { id: true },
  });
  await Promise.all(
    dueSuperlativeVotings.map((s) => finalizeSuperlativeVotingIfDue(s.id))
  );

  const sessions = await prisma.session.findMany({
    include: {
      decidedGame: true,
      _count: { select: { proposals: true } },
      proposals: {
        select: {
          gameId: true,
          votes: {
            select: {
              userId: true,
              user: { select: { discordName: true, discordAvatar: true, color: true } },
            },
          },
        },
      },
    },
    orderBy: { date: "desc" },
  });

  // "À venir" : les plus proches en premier (le tri global desc ci-dessus
  // convient à l'historique mais pas ici — on veut voir ce qui arrive,
  // pas ce qui arrive le plus tard).
  const upcoming = sessions
    .filter((s) => s.status === "VOTING" || s.status === "SCHEDULED")
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const pastAll = sessions.filter((s) => s.status === "DONE" || s.status === "CANCELLED");
  const pastDisplayed = showCancelled ? pastAll : pastAll.filter((s) => s.status !== "CANCELLED");

  const pendingSuperlativeVotes = await getPendingSuperlativeVoteSessionIds(
    user.id,
    pastAll.filter((s) => s.status === "DONE").map((s) => s.id)
  );

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Soirées
      </h1>

      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {/* Formulaire à gauche, liste à droite sur desktop — plus de scroll
          interminable pour retrouver le formulaire après avoir consulté
          la liste. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[380px_1fr] lg:items-start">
        <Card>
          <form action={createSession} className="flex flex-col gap-3">
            <h2 className="font-semibold text-foreground">Nouvelle soirée</h2>

            {preselectedGame && (
              <div className="flex items-center gap-2 rounded-lg bg-accent/10 p-3 text-sm text-accent">
                <input type="hidden" name="gameId" value={preselectedGame.id} />
                🎮 Cette soirée proposera automatiquement{" "}
                <strong>{preselectedGame.name}</strong>
              </div>
            )}

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
                  defaultValue={prefillDate}
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
                  defaultValue={prefillTime}
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
                <option value="0.5">30 min avant la session</option>
                <option value="1">1h avant la session</option>
                <option value="2">2h avant la session</option>
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

            <ReminderTimingsField />

            <NotifyRecipientsField potes={potes} tags={tagOptions} />

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="custom-reminder">
                Message de rappel perso (optionnel)
              </label>
              <textarea
                id="custom-reminder"
                name="customReminderMessage"
                rows={2}
                placeholder="Remplace le tirage aléatoire — variables : {pote} {jeu} {heure}"
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </div>

            <Button type="submit" variant="primary" fullWidthOnMobile>
              Créer la soirée
            </Button>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <div className="flex gap-2 rounded-lg border border-border bg-background p-1">
            <Link
              href="/sessions?tab=upcoming"
              className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
                activeTab === "upcoming"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              À venir
            </Link>
            <Link
              href="/sessions?tab=history"
              className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Historique
            </Link>
          </div>

          {activeTab === "upcoming" ? (
            <section className="flex flex-col gap-3">
              {upcoming.length === 0 && (
                <p className="text-sm text-muted">
                  Aucune soirée prévue pour l&apos;instant.
                </p>
              )}
              <Stagger className="flex flex-col gap-3">
                {upcoming.map((session) => (
                  <StaggerItem key={session.id}>
                    <SessionRow session={session} needsSuperlativeVote={false} />
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          ) : (
            <section className="flex flex-col gap-3">
              <Link
                href={`/sessions?tab=history${showCancelled ? "" : "&cancelled=1"}`}
                className="flex w-fit items-center gap-2 text-sm text-muted hover:text-foreground"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    showCancelled ? "border-accent bg-accent" : "border-border"
                  }`}
                >
                  {showCancelled && (
                    <span className="text-[10px] leading-none text-accent-foreground">✓</span>
                  )}
                </span>
                Afficher les annulées
              </Link>
              {pastDisplayed.length === 0 && (
                <p className="text-sm text-muted">Aucune soirée dans l&apos;historique.</p>
              )}
              <Stagger className="flex flex-col gap-3">
                {pastDisplayed.map((session) => (
                  <StaggerItem key={session.id}>
                    <SessionRow
                      session={session}
                      needsSuperlativeVote={pendingSuperlativeVotes.has(session.id)}
                    />
                  </StaggerItem>
                ))}
              </Stagger>
            </section>
          )}
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}
