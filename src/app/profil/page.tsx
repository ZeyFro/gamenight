import Link from "next/link";
import { redirect } from "next/navigation";
import type { XpReason } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatDateTimeFr } from "@/lib/wallclock";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { Card } from "@/components/ui/Card";

const XP_REASON_LABELS: Record<XpReason, string> = {
  CREATE_SESSION: "a créé une soirée",
  VOTE: "a voté pour un jeu",
  PARTICIPATE: "a participé à une soirée",
  AVAILABILITY_FIRST: "a réglé ses disponibilités",
  STEAM_LINK_FIRST: "a lié son compte Steam",
  SESSION_RESULT: "a reçu un bonus de résultats",
  SUPERLATIVE_AWARD: "a gagné une récompense",
  BADGE_UNLOCKED: "a débloqué un badge",
  CHALLENGE_COMPLETE: "a complété le défi de la semaine",
  PRONOSTIC_CORRECT: "a fait un pronostic correct",
  XP_BET_WON: "a gagné un pari d'XP",
  TOURNAMENT_RESULT: "a marqué en tournoi",
};

/** Onglet "Aperçu" (route par défaut de /profil) — voir `layout.tsx` pour l'en-tête. */
export default async function ProfilApercuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const [nextSession, lastActivity, recentAwards, pronosticStats, recentBets] =
    await Promise.all([
      prisma.session.findFirst({
        where: { status: { in: ["VOTING", "SCHEDULED"] } },
        include: { decidedGame: true },
        orderBy: { date: "asc" },
      }),
      prisma.xpEvent.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.superlativeAward.findMany({
        where: { winnerUserId: user.id },
        include: { category: true, session: { include: { decidedGame: true } } },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      // Sprint 4 (Pronostics) — taux de réussite sur les pronos déjà résolus
      // (`correct` non-null), un prono en attente (soirée pas encore
      // `DONE`) ne compte ni pour ni contre.
      prisma.pronostic.groupBy({
        by: ["correct"],
        where: { voterId: user.id, correct: { not: null } },
        _count: { _all: true },
      }),
      // Sprint 4 (Paris d'XP) — historique gains/pertes, résolus seulement.
      prisma.xpBet.findMany({
        where: { voterId: user.id, won: { not: null } },
        include: { target: true, session: { select: { decidedGame: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  const pronosticCorrect =
    pronosticStats.find((s) => s.correct === true)?._count._all ?? 0;
  const pronosticTotal = pronosticStats.reduce((sum, s) => sum + s._count._all, 0);
  const pronosticRate =
    pronosticTotal > 0 ? Math.round((pronosticCorrect / pronosticTotal) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Prochaine soirée</h2>
        {nextSession ? (
          <Link href={`/sessions/${nextSession.id}`}>
            <Card className="card-glow flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground capitalize">
                  {formatDateTimeFr(nextSession.date)}
                </p>
                <p className="text-sm text-muted">
                  {nextSession.decidedGame?.name ?? "Jeu pas encore décidé"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${SESSION_STATUS_LABELS[nextSession.status].className}`}
              >
                {SESSION_STATUS_LABELS[nextSession.status].label}
              </span>
            </Card>
          </Link>
        ) : (
          <Card>
            <p className="text-sm text-muted">Aucune soirée prévue pour l&apos;instant.</p>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Dernière activité</h2>
        <Card>
          {lastActivity ? (
            <p className="text-sm text-foreground">
              {XP_REASON_LABELS[lastActivity.reason]} · {formatDateTimeFr(lastActivity.createdAt)}{" "}
              <span className="text-muted">(+{lastActivity.amount} XP)</span>
            </p>
          ) : (
            <p className="text-sm text-muted">Aucune activité pour l&apos;instant.</p>
          )}
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted">Récompenses récentes</h2>
          <Link href="/profil/superlatifs" className="text-xs text-accent hover:underline">
            Voir tout →
          </Link>
        </div>
        {recentAwards.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">Aucune récompense gagnée pour l&apos;instant.</p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recentAwards.map((award) => (
              <Card key={award.id} className="flex items-center gap-3">
                <span className="text-xl" aria-hidden>
                  {award.category.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{award.category.name}</p>
                  <p className="text-xs text-muted">
                    {award.session.decidedGame?.name ?? "?"}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {pronosticTotal > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">🔮 Pronostics</h2>
          <Card>
            <p className="text-sm text-foreground">
              {pronosticCorrect}/{pronosticTotal} corrects
              <span className="text-muted"> ({pronosticRate}%)</span>
            </p>
          </Card>
        </section>
      )}

      {recentBets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted">🎲 Paris récents</h2>
          <div className="flex flex-col gap-2">
            {recentBets.map((bet) => (
              <Card key={bet.id} className="flex items-center justify-between gap-3">
                <p className="text-sm text-foreground">
                  {bet.amount} XP sur {bet.target.discordName}
                  {bet.session.decidedGame && (
                    <span className="text-muted"> · {bet.session.decidedGame.name}</span>
                  )}
                </p>
                <span
                  className={`shrink-0 text-sm font-semibold ${bet.won ? "text-accent" : "text-destructive"}`}
                >
                  {bet.won ? `+${bet.amount * 2}` : `-${bet.amount}`}
                </span>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
