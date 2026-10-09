import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { XP_REASON_LABELS } from "@/lib/xp-reason-labels";
import { getCurrentUser } from "@/lib/current-user";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { prisma } from "@/lib/prisma";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { formatDateTimeFr, nowMs } from "@/lib/wallclock";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { Card } from "@/components/ui/Card";
import { FadeInView } from "@/components/ui/FadeInView";
import { XpEvolutionChart, type XpEvolutionPoint } from "@/components/XpEvolutionChart";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Mon profil");

const XP_CHART_DAYS = 30;

/** Onglet "Aperçu" (route par défaut de /profil) — voir `layout.tsx` pour l'en-tête. */
export default async function ProfilApercuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const scopedDb = await getActiveScopedPrisma(user.id);
  const communityId = await writeCommunityIdForUser(user.id);
  const progressCommunity = { communityId: { in: communityId ? [communityId] : [] } };

  const now = nowMs();
  const xpChartSince = new Date(now - XP_CHART_DAYS * 24 * 60 * 60 * 1000);

  const [
    nextSession,
    lastActivity,
    recentAwards,
    pronosticStats,
    recentBets,
    sessionResults,
    xpBetsWon,
    recentXpEvents,
  ] = await Promise.all([
    prisma.session.findFirst({
      where: { AND: [await accessibleSessionWhereFor(user.id), { status: { in: ["VOTING", "SCHEDULED"] } }] },
      include: { decidedGame: true },
      orderBy: { date: "asc" },
    }),
    scopedDb.xpEvent.findFirst({
      where: { userId: user.id, ...progressCommunity },
      orderBy: { createdAt: "desc" },
    }),
    // Chantier nettoyage réel du stockage (V2, suite) — `gameName`
    // dénormalisé, survit à la purge de la soirée (jamais de jointure
    // `session.decidedGame` qui deviendrait `null`).
    scopedDb.superlativeAward.findMany({
      where: { winnerUserId: user.id },
      include: { category: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    // Sprint 4 (Pronostics) — taux de réussite sur les pronos déjà résolus
    // (`correct` non-null), un prono en attente (soirée pas encore
    // `DONE`) ne compte ni pour ni contre. `Pronostic` survit désormais à
    // la purge de sa soirée (`onDelete: SetNull`) — ce taux reste exact À
    // VIE, jamais sous-compté au fil des purges.
    scopedDb.pronostic.groupBy({
      by: ["correct"],
      where: { voterId: user.id, correct: { not: null } },
      _count: { _all: true },
    }),
    // Sprint 4 (Paris d'XP) — historique gains/pertes, résolus seulement.
    // `gameName` dénormalisé (voir `XpBet` dans le schéma).
    scopedDb.xpBet.findMany({
      where: { voterId: user.id, won: { not: null } },
      include: { target: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    // Amélioration profil (stats) — sert à la fois le win rate et le jeu
    // le plus joué, une seule requête pour les deux. `gameId`/`gameName`
    // dénormalisés sur `SessionResult` (survit à la purge de sa soirée).
    scopedDb.sessionResult.findMany({
      where: { userId: user.id },
      select: { placement: true, gameId: true, gameName: true },
    }),
    scopedDb.xpBet.aggregate({
      where: { voterId: user.id, won: true },
      _sum: { amount: true },
    }),
    scopedDb.xpEvent.findMany({
      where: { userId: user.id, ...progressCommunity, createdAt: { gte: xpChartSince } },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const pronosticCorrect =
    pronosticStats.find((s) => s.correct === true)?._count._all ?? 0;
  const pronosticTotal = pronosticStats.reduce((sum, s) => sum + s._count._all, 0);
  const pronosticRate =
    pronosticTotal > 0 ? Math.round((pronosticCorrect / pronosticTotal) * 100) : null;

  // Amélioration profil (stats) — win rate calculé uniquement sur les
  // soirées compétitives (`placement` non-null) : une soirée coop n'a pas
  // de podium (`placement` toujours `null`, cf. `submitSessionResultsAction`
  // dans sessions/actions.ts) donc pas de notion de "gagnée/perdue" fiable
  // à en tirer sans introduire un nouveau signal en base.
  const competitiveResults = sessionResults.filter((r) => r.placement !== null);
  const winRate =
    competitiveResults.length > 0
      ? Math.round(
          (competitiveResults.filter((r) => r.placement === 1).length /
            competitiveResults.length) *
            100
        )
      : null;

  // Jeu le plus joué — toutes soirées confondues (coop incluses), simple
  // décompte en mémoire (pas de `groupBy` possible à travers une relation
  // en Prisma), même approche que `monthly-recap.ts`. Basé sur
  // `SessionResult.gameId`/`gameName` (dénormalisés, survivent à la purge
  // de la soirée) — jamais `session.decidedGame`.
  const gamePlayCounts = new Map<string, { name: string; count: number }>();
  for (const result of sessionResults) {
    if (!result.gameId || !result.gameName) continue;
    const entry = gamePlayCounts.get(result.gameId);
    if (entry) entry.count += 1;
    else gamePlayCounts.set(result.gameId, { name: result.gameName, count: 1 });
  }
  const topGameEntry = [...gamePlayCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  // `coverUrl` n'est jamais dénormalisé (uniquement nécessaire pour LE jeu
  // le plus joué, une lecture supplémentaire ciblée suffit — `Game`
  // lui-même n'est jamais purgé par ce chantier, sa couverture reste
  // toujours accessible).
  const topGame = topGameEntry
    ? await prisma.game.findUnique({ where: { id: topGameEntry[0] }, select: { coverUrl: true } })
    : null;
  const mostPlayedGame = topGameEntry
    ? { name: topGameEntry[1].name, count: topGameEntry[1].count, coverUrl: topGame?.coverUrl ?? null }
    : null;

  // Paris d'XP gagnés payent double (cf. `resolveBets` dans xp-bets.ts).
  const xpWonFromBets = (xpBetsWon._sum.amount ?? 0) * 2;

  const memberSinceDays = Math.floor(
    (now - user.createdAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  // Courbe XP 30 jours — cumul reconstruit à partir de `xpTotal` actuel
  // moins la somme des événements de la période (= XP au tout début de la
  // fenêtre), puis on ajoute jour par jour. Un jour sans XpEvent garde le
  // même total que la veille (ligne plate, pas un trou dans le graphe).
  const xpAtWindowStart =
    user.xpTotal - recentXpEvents.reduce((sum, e) => sum + e.amount, 0);
  const dailyXpGain = new Map<string, number>();
  for (const event of recentXpEvents) {
    const key = event.createdAt.toISOString().slice(0, 10);
    dailyXpGain.set(key, (dailyXpGain.get(key) ?? 0) + event.amount);
  }
  const xpEvolution: XpEvolutionPoint[] = [];
  let runningXp = xpAtWindowStart;
  for (let i = XP_CHART_DAYS - 1; i >= 0; i--) {
    const day = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    runningXp += dailyXpGain.get(key) ?? 0;
    xpEvolution.push({
      label: `${String(day.getDate()).padStart(2, "0")}/${String(day.getMonth() + 1).padStart(2, "0")}`,
      xp: runningXp,
    });
  }

  return (
    <FadeInView className="flex flex-col gap-6">
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted">📊 Statistiques</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-lg font-bold text-foreground">
              {winRate === null ? "—" : `${winRate}%`}
            </span>
            <span className="text-[11px] text-muted">Win rate</span>
          </Card>
          <Card className="flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-lg font-bold text-foreground">{user.bestStreakCount}</span>
            <span className="text-[11px] text-muted">Meilleur streak</span>
          </Card>
          <Card className="flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-lg font-bold text-foreground">
              {pronosticTotal === 0 ? "—" : `${pronosticCorrect}/${pronosticTotal}`}
            </span>
            <span className="text-[11px] text-muted">
              Pronos {pronosticTotal > 0 && `(${pronosticRate}%)`}
            </span>
          </Card>
          <Card className="flex flex-col items-center gap-1 p-3 text-center">
            <span className="text-lg font-bold text-foreground">
              {xpWonFromBets > 0 ? `+${xpWonFromBets}` : "0"}
            </span>
            <span className="text-[11px] text-muted">XP gagné en paris</span>
          </Card>
        </div>

        {mostPlayedGame && (
          <Card className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-background">
              {mostPlayedGame.coverUrl ? (
                <Image
                  src={mostPlayedGame.coverUrl}
                  alt={mostPlayedGame.name}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center p-1 text-center text-[9px] leading-tight text-muted">
                  {mostPlayedGame.name}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">Jeu le plus joué</p>
              <p className="truncate text-sm font-medium text-foreground">{mostPlayedGame.name}</p>
              <p className="text-xs text-muted">
                {mostPlayedGame.count} soirée{mostPlayedGame.count > 1 ? "s" : ""}
              </p>
            </div>
          </Card>
        )}

        <Card className="flex flex-col gap-2">
          <p className="text-xs text-muted">Évolution XP — 30 derniers jours</p>
          <div className="h-32">
            <XpEvolutionChart data={xpEvolution} />
          </div>
        </Card>

        <p className="text-xs text-muted">
          Membre depuis {memberSinceDays} jour{memberSinceDays > 1 ? "s" : ""}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted">Dernière activité</h2>
        <Card>
          {lastActivity ? (
            <p className="text-sm text-foreground">
              {XP_REASON_LABELS[lastActivity.reason]} · {formatDateTimeFr(lastActivity.createdAt)}{" "}
              <span className="text-muted">({lastActivity.amount > 0 ? `+${lastActivity.amount}` : lastActivity.amount} XP)</span>
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
                    {award.gameName ?? "?"}
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
                  {bet.gameName && <span className="text-muted"> · {bet.gameName}</span>}
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
    </FadeInView>
  );
}
