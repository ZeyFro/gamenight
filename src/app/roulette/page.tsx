import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { toDateInputValue, wallClockNow, formatDateTimeFr } from "@/lib/wallclock";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { Stagger, StaggerItem } from "@/components/motion";
import { PullToRefresh } from "@/components/PullToRefresh";
import { RouletteWizard } from "@/components/roulette/RouletteWizard";

const ROULETTE_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: RATE_LIMIT_MESSAGE,
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

export default async function RoulettePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { tab, error } = await searchParams;
  const activeTab: "roue" | "historique" = tab === "historique" ? "historique" : "roue";
  const errorMessage = error ? ROULETTE_ERROR_MESSAGES[error] : null;

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
      discordName: user.discordName,
      discordAvatar: user.discordAvatar,
      color: user.color,
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

  const now = wallClockNow();
  const defaultDate = toDateInputValue(now);

  const history =
    activeTab === "historique"
      ? await prisma.session.findMany({
          where: { createdViaRoulette: true },
          orderBy: { date: "desc" },
          include: { decidedGame: { select: { name: true, coverUrl: true } } },
        })
      : [];

  return (
    <PullToRefresh>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🎰 Roulette</h1>

        {errorMessage && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex gap-2 rounded-lg border border-border bg-background p-1">
          <Link
            href="/roulette?tab=roue"
            className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              activeTab === "roue"
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            La roue
          </Link>
          <Link
            href="/roulette?tab=historique"
            className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              activeTab === "historique"
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            Historique
          </Link>
        </div>

        {activeTab === "roue" ? (
          <RouletteWizard
            candidates={candidates}
            defaultDate={defaultDate}
            soundEnabled={user.soundEnabled}
          />
        ) : (
          <section className="flex flex-col gap-3">
            {history.length === 0 ? (
              <p className="text-sm text-muted">Aucune roulette lancée pour l&apos;instant.</p>
            ) : (
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
            )}
          </section>
        )}
      </div>
    </PullToRefresh>
  );
}
