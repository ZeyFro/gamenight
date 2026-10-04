import Link from "next/link";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { toDateInputValue, wallClockNow, formatDateTimeFr } from "@/lib/wallclock";
import { resolveNotifiedUserIds } from "@/lib/notify-recipients";
import { accessibleSessionWhere } from "@/lib/session-access";
import { isSessionVisibleInHistory } from "@/lib/sessions";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { PullToRefresh } from "@/components/PullToRefresh";
import { NotifyRecipientsField } from "@/components/NotifyRecipientsField";
import { RouletteWizard } from "@/components/roulette/RouletteWizard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { createRouletteAction } from "./actions";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Roulette");

const ROULETTE_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
  deadline_trop_proche:
    "La deadline de proposition tombe déjà dans le passé — recule l'heure de la soirée ou raccourcis le délai.",
};

export default async function RoulettePage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    tab?: string;
    error?: string;
    date?: string;
    time?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { mode, tab, error, date, time } = await searchParams;
  const isInstant = mode === "instant";
  const activeTab: "en-cours" | "creer" | "historique" =
    tab === "creer" ? "creer" : tab === "historique" ? "historique" : "en-cours";
  const errorMessage = error ? ROULETTE_ERROR_MESSAGES[error] : null;

  const now = wallClockNow();
  const defaultDate = date || toDateInputValue(now);
  const defaultTime = time || "20:00";

  return (
    <PullToRefresh>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🎰 Roulette</h1>

        {errorMessage && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <SegmentedControl
          groupId="roulette-mode"
          activeKey={isInstant ? "instant" : "async"}
          options={[
            { key: "async", label: "Mode async", href: "/roulette" },
            { key: "instant", label: "Mode instant", href: "/roulette?mode=instant" },
          ]}
        />
        {isInstant ? (
          <InstantMode user={user} />
        ) : (
          <>
            <SegmentedControl
              groupId="roulette-tabs"
              activeKey={activeTab}
              options={[
                { key: "en-cours", label: "En cours", href: "/roulette?tab=en-cours" },
                { key: "creer", label: "Créer", href: "/roulette?tab=creer" },
                { key: "historique", label: "Historique", href: "/roulette?tab=historique" },
              ]}
            />

            {activeTab === "en-cours" && <EnCoursTab userId={user.id} />}
            {activeTab === "creer" && (
              <CreerTab userId={user.id} defaultDate={defaultDate} defaultTime={defaultTime} />
            )}
            {activeTab === "historique" && <HistoriqueTab userId={user.id} />}
          </>
        )}
      </div>
    </PullToRefresh>
  );
}

/**
 * Onglet "En cours" — cartes des roulettes async `OPEN`, jamais les jeux
 * proposés (surprise), juste qui a proposé.
 *
 * Confidentialité — une roulette n'a pas de table d'invitation dédiée
 * (`SessionInvite` couvre les `Session`, pas les `Roulette` elles-mêmes,
 * qui n'EN DEVIENNENT une qu'au tirage) : `notifiedUserIds`, seule
 * intention d'invitation existante ici (déjà la source du chemin webhook,
 * `discord-roulette.ts`), sert donc aussi de liste d'accès. Filtré en
 * mémoire après un fetch complet (échelle "groupe d'amis", même
 * philosophie assumée que `calendar.ts`) plutôt qu'une requête JSON
 * `array_contains` fragile sur `notifiedUserIds`.
 */
async function EnCoursTab({ userId }: { userId: string }) {
  const allOpenRoulettes = await prisma.roulette.findMany({
    where: { status: "OPEN" },
    orderBy: { deadline: "asc" },
    select: {
      id: true,
      createdById: true,
      scheduledAt: true,
      deadline: true,
      notifiedUserIds: true,
      entries: { select: { userId: true } },
    },
  });
  const openRoulettes = allOpenRoulettes.filter(
    (r) => r.createdById === userId || (resolveNotifiedUserIds(r.notifiedUserIds) ?? []).includes(userId)
  );

  const allInvitedIds = [
    ...new Set(openRoulettes.flatMap((r) => resolveNotifiedUserIds(r.notifiedUserIds) ?? [])),
  ];
  const usersById = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: allInvitedIds } },
        select: { id: true, discordName: true, discordAvatar: true, color: true },
      })
    ).map((u) => [u.id, u])
  );

  if (openRoulettes.length === 0) {
    return <EmptyState icon="🎰" title="Aucune roulette en cours pour l'instant." />;
  }

  return (
    <Stagger className="flex flex-col gap-3">
      {openRoulettes.map((r) => {
        const counts = new Map<string, number>();
        for (const e of r.entries) counts.set(e.userId, (counts.get(e.userId) ?? 0) + 1);
        const proposedCount = [...counts.values()].filter((c) => c >= 2).length;
        const invitedIds = resolveNotifiedUserIds(r.notifiedUserIds) ?? [];
        const invited = invitedIds.map((id) => usersById.get(id)).filter((u) => u !== undefined);

        return (
          <StaggerItem key={r.id}>
            <Link href={`/roulette/${r.id}`}>
              <Card className="card-glow flex flex-col gap-2 transition-all duration-200">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground capitalize">
                    {formatDateTimeFr(r.scheduledAt)}
                  </p>
                  <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    {proposedCount}/{invited.length} ont proposé
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Propositions jusqu&apos;au {formatDateTimeFr(r.deadline)}
                </p>
                <div className="flex -space-x-2">
                  {invited.slice(0, 8).map((u) => (
                    <Avatar
                      key={u.id}
                      src={u.discordAvatar}
                      alt={u.discordName}
                      size={28}
                      className="ring-2 ring-surface"
                    />
                  ))}
                </div>
              </Card>
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/** Onglet "Créer" — créneau + deadline de proposition + participants invités (même sélecteur que le ping sélectif). */
async function CreerTab({
  userId,
  defaultDate,
  defaultTime,
}: {
  userId: string;
  defaultDate: string;
  defaultTime: string;
}) {
  const potesRaw = await prisma.user.findMany({
    where: { id: { not: userId } },
    select: { id: true, discordName: true, discordAvatar: true, color: true },
    orderBy: { discordName: "asc" },
  });
  const potes = potesRaw.map((p) => ({ ...p, tagIds: [] as string[] }));

  return (
    <Card>
      <form action={createRouletteAction} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted" htmlFor="roulette-scheduled-date">
              Date de la soirée
            </label>
            <input
              id="roulette-scheduled-date"
              type="date"
              name="date"
              required
              defaultValue={defaultDate}
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted" htmlFor="roulette-scheduled-time">
              Heure
            </label>
            <input
              id="roulette-scheduled-time"
              type="time"
              name="time"
              required
              defaultValue={defaultTime}
              className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="roulette-deadline-offset">
            Deadline pour proposer ses jeux
          </label>
          <select
            id="roulette-deadline-offset"
            name="deadlineOffset"
            defaultValue="1"
            className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="0.5">30 min avant la soirée</option>
            <option value="1">1h avant la soirée</option>
            <option value="2">2h avant la soirée</option>
            <option value="6">6h avant la soirée</option>
            <option value="12">12h avant la soirée</option>
            <option value="24">24h avant la soirée</option>
            <option value="48">48h avant la soirée</option>
          </select>
        </div>

        <NotifyRecipientsField potes={potes} fieldName="participantId" label="Participants" />

        <Button type="submit" variant="primary" fullWidthOnMobile>
          Créer la roulette 🎰
        </Button>
      </form>
    </Card>
  );
}

/**
 * Historique — sessions créées via la roue (mode instant OU async, les
 * deux posent `createdViaRoulette: true`). Confidentialité des soirées —
 * restreint aux sessions visibles par ce viewer (`accessibleSessionWhere`,
 * même contrôle d'accès que `/sessions`) : une soirée issue d'une roulette
 * reste une `Session` normale, ses invitations réelles vivent dans
 * `SessionInvite` (posées par `createRouletteResultSession`, voir
 * src/lib/sessions.ts), jamais dans `Roulette.notifiedUserIds` une fois le
 * tirage effectué.
 */
async function HistoriqueTab({ userId }: { userId: string }) {
  const historyAll = await prisma.session.findMany({
    where: { createdViaRoulette: true, ...accessibleSessionWhere(userId) },
    orderBy: { date: "desc" },
    include: { decidedGame: { select: { name: true, coverUrl: true } } },
  });

  // Cycle de vie de l'historique (V2, bug remonté en test réel) — même
  // fenêtre de 7 jours que `/sessions`, jamais appliquée à une soirée
  // encore active (voir `isSessionVisibleInHistory`, sessions.ts).
  const history = historyAll.filter((s) => isSessionVisibleInHistory(s));

  if (history.length === 0) {
    return <EmptyState icon="📜" title="Aucune roulette lancée pour l'instant." />;
  }

  return (
    <Stagger className="flex flex-col gap-3">
      {history.map((session) => {
        const status = SESSION_STATUS_LABELS[session.status];
        return (
          <StaggerItem key={session.id}>
            <Link href={`/sessions/${session.id}`}>
              <div className="card-glow flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-all duration-200">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground capitalize">
                    {formatDateTimeFr(session.date)}
                  </p>
                  <p className="truncate text-sm text-muted">
                    🎰 {session.decidedGame?.name ?? "?"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
                >
                  {status.label}
                </span>
              </div>
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/** Mode instant (existant, inchangé) — tout le monde présent en même temps, une seule session côté client. */
async function InstantMode({ user }: { user: User }) {
  const [meGames, potesRaw] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId: user.id, owned: true },
      select: { game: { select: { id: true, name: true, coverUrl: true } } },
      orderBy: { game: { name: "asc" } },
    }),
    prisma.user.findMany({
      where: { id: { not: user.id } },
      select: {
        id: true,
        discordName: true,
        discordAvatar: true,
        color: true,
        userGames: {
          where: { owned: true },
          select: { game: { select: { id: true, name: true, coverUrl: true } } },
          orderBy: { game: { name: "asc" } },
        },
      },
      orderBy: { discordName: "asc" },
    }),
  ]);

  const candidates = [
    {
      id: user.id,
      discordName: (user as { discordName: string }).discordName,
      discordAvatar: (user as { discordAvatar: string | null }).discordAvatar,
      color: (user as { color: string }).color,
      games: meGames.map((g) => g.game),
    },
    ...potesRaw.map((p) => ({
      id: p.id,
      discordName: p.discordName,
      discordAvatar: p.discordAvatar,
      color: p.color,
      games: p.userGames.map((g) => g.game),
    })),
  ];

  const defaultDate = toDateInputValue(wallClockNow());

  return (
    <RouletteWizard candidates={candidates} defaultDate={defaultDate} soundEnabled={user.soundEnabled} />
  );
}
