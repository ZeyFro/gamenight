
import { CreationForm } from "@/components/CreationForm";
import { GameWarnings } from "@/components/GameWarnings";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Game, Session } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { requireCommunityChosen } from "@/lib/community-picker";
import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { closeSessionIfDue, isSessionVisibleInHistory } from "@/lib/sessions";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { creationMemberUserWhere } from "@/lib/community-isolation";
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
import { createSession } from "./actions/session-lifecycle";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";
import { ReminderTimingsField } from "@/components/ReminderTimingsField";
import { SessionPlanningFields } from "@/components/sessions/SessionPlanningFields";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { tagColor } from "@/lib/tags";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Soirées");

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
  await requireCommunityChosen(user.id, "/sessions");

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
      // Multi-communautés (PR4) : potes proposables = membres de la
      // communauté active du créateur (aucun filtre si l'isolation est éteinte).
      where: { AND: [{ id: { not: user.id } }, await creationMemberUserWhere(user.id)] },
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

  const scopedDb = await getActiveScopedPrisma(user.id);
  const dueSessions = await scopedDb.session.findMany({
    where: { status: "VOTING", date: { lte: wallClockNow() } },
    select: { id: true },
  });
  await Promise.all(dueSessions.map((s) => closeSessionIfDue(s.id)));

  const dueSuperlativeVotings = await scopedDb.session.findMany({
    where: { status: "DONE", superlativeVotingClosed: false },
    select: { id: true },
  });
  await Promise.all(
    dueSuperlativeVotings.map((s) => finalizeSuperlativeVotingIfDue(s.id))
  );

  // Confidentialité des soirées — seules les soirées créées par l'utilisateur
  // ou auxquelles il est activement invité apparaissent ici (voir
  // src/lib/session-access.ts, source de vérité unique du contrôle d'accès).
  const sessions = await scopedDb.session.findMany({
    where: await accessibleSessionWhereFor(user.id),
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
  // Cycle de vie de l'historique (V2, bug remonté en test réel) — une
  // soirée terminée/annulée depuis plus de 7 jours sort de CETTE LISTE
  // (jamais de la base ni de l'accès direct par id, voir
  // `isSessionVisibleInHistory`, sessions.ts). `pastAll` sert aussi à
  // `getPendingSuperlativeVoteSessionIds` ci-dessous : les votes de
  // récompenses restent calculés sur TOUTES les soirées `DONE` visibles
  // ici (une soirée qui sort de l'historique n'a plus de fenêtre de vote
  // ouverte de toute façon, `superlativeVotingDeadline` étant posée à
  // +24h de la clôture — bien avant tout retrait à 7 jours).
  const pastAll = sessions.filter(
    (s) => (s.status === "DONE" || s.status === "CANCELLED") && isSessionVisibleInHistory(s)
  );
  const pastDisplayed = showCancelled ? pastAll : pastAll.filter((s) => s.status !== "CANCELLED");

  const pendingSuperlativeVotes = await getPendingSuperlativeVoteSessionIds(
    user.id,
    pastAll.filter((s) => s.status === "DONE").map((s) => s.id)
  );

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          Soirées
        </h1>
        <div className="flex min-w-0 flex-wrap gap-2">
          <ButtonLink href="/sessions/sondages" variant="secondary" size="sm">
            Préparer une soirée
          </ButtonLink>
          {/* Roue du gambling (Sprint 3) — accès depuis /sessions, cf. spec. */}
          <ButtonLink href="/roulette" variant="secondary" size="sm">
            🎰 Roulette
          </ButtonLink>
          {/* Tournois bracket (Sprint 5) — même logique de découvrabilité. */}
          <ButtonLink href="/tournois" variant="secondary" size="sm">
            🏆 Tournois
          </ButtonLink>
          {/* V2 — "Jouer maintenant", même logique de découvrabilité —
              distinct d'une soirée planifiée ET de la roulette. */}
          <ButtonLink href="/jouer-maintenant" variant="secondary" size="sm">
            🎮 Jouer maintenant
          </ButtonLink>
        </div>
      </div>

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
          <CreationForm action={createSession} className="flex flex-col gap-3">
            <h2 id="nouvelle-soiree" className="scroll-mt-24 font-semibold text-foreground">Nouvelle soirée</h2>

            {preselectedGame && (
              <div className="flex flex-col gap-2 rounded-lg bg-accent/10 p-3 text-sm text-accent">
                <input type="hidden" name="gameId" value={preselectedGame.id} />
                <p>🎮 Cette soirée proposera automatiquement <strong>{preselectedGame.name}</strong></p>
                <GameWarnings game={preselectedGame} />
              </div>
            )}

            <SessionPlanningFields potes={potes} tags={tagOptions} minDate={toDateInputValue(todayDateOnly())} initialDate={prefillDate} initialTime={prefillTime} />

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="deadline-offset">
                Deadline de vote
              </label>
              <select
                id="deadline-offset"
                name="deadlineOffset"
                defaultValue="6"
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
              </div>
            </details>

            <ReminderTimingsField />

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="custom-reminder">
                Message de rappel perso (optionnel)
              </label>
              <textarea
                id="custom-reminder"
                name="customReminderMessage"
                rows={2}
                placeholder="Remplace le tirage aléatoire — variables : {pote} {jeu} {heure}"
                className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>

            <Button type="submit" variant="primary" fullWidthOnMobile>
              Créer la soirée
            </Button>
          </CreationForm>
        </Card>

        <div className="flex flex-col gap-4">
          <SegmentedControl
            groupId="sessions-tabs"
            activeKey={activeTab}
            options={[
              { key: "upcoming", label: "À venir", href: "/sessions?tab=upcoming" },
              { key: "history", label: "Historique", href: "/sessions?tab=history" },
            ]}
          />

          {activeTab === "upcoming" ? (
            <section className="flex flex-col gap-3">
              {upcoming.length === 0 && (
                <EmptyState icon="🎮" title="Pas encore de soirée — crée la première 🎮" />
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
                <EmptyState icon="📜" title="Aucune soirée dans l'historique." />
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
