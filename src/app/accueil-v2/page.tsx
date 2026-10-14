import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { isHomeV2Enabled } from "@/lib/home-v2";
import { loadHomeData } from "@/lib/home-data";
import { pageMetadata } from "@/lib/page-title";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, formatDurationFr } from "@/lib/wallclock";
import { setDebtGageAction, markDebtPaidAction } from "@/app/dettes/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CountUp } from "@/components/ui/CountUp";
import { FloatingParticles } from "@/components/FloatingParticles";
import { ParallaxHeader } from "@/components/ui/ParallaxHeader";
import { Avatar } from "@/components/ui/Avatar";
import { RankAvatar } from "@/components/RankAvatar";
import { PodiumSpot } from "@/components/PodiumSpot";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";

export const metadata = pageMetadata("Accueil (aperçu)");

/**
 * Accueil v2 — MÊMES données et MÊMES contenus que `/` (voir
 * `src/lib/home-data.ts`), même en-tête et même navigation (ceux du layout),
 * mêmes cartes, mêmes libellés. Seuls changent la hiérarchie et l'espacement :
 *
 * 1. la prochaine soirée en grand, puis les trois actions ;
 * 2. « cette semaine » (dispos, activité) ;
 * 3. « le groupe » (classement, stats) ;
 * 4. le reste, dans le même ordre qu'avant.
 *
 * Derrière `HOME_V2_ENABLED` (404 sinon). Lecture seule : aucune action
 * n'est ajoutée, les formulaires de dettes sont ceux de l'accueil actuel.
 */
export default async function AccueilV2Page() {
  if (!isHomeV2Enabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/");

  const d = await loadHomeData(user);
  const [first, second, third] = d.scoreboard.slice(0, 3);
  const podiumCount = d.scoreboard.slice(0, 3).length;

  return (
    <PullToRefresh>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:max-w-6xl">
        <ParallaxHeader className="relative flex items-center gap-4">
          <FloatingParticles />
          <RankAvatar
            src={user.discordAvatar}
            alt={`Avatar de ${user.discordName}`}
            level={d.level}
            rank={d.rank}
            size={64}
          />
          <div className="min-w-0">
            <p className="text-sm text-muted">Salut,</p>
            <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">
              {user.discordName}
              {d.activeDebtorIds.has(user.id) && (
                <span className="ml-1" title="Dette de gage active">
                  💀
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-xs text-muted">
              Niveau {d.level} · {d.title} · {d.rank.name}
            </p>
          </div>
          <ButtonLink href="/guide" variant="ghost" size="sm" className="shrink-0 !px-2">
            📖 Guide
          </ButtonLink>
        </ParallaxHeader>

        <Stagger className="flex flex-col gap-8" staggerDelay={0.1}>
          {/* 1 — La prochaine soirée, puis les actions. */}
          <section className="flex flex-col gap-4">
            <StaggerItem>
              {d.nextSession ? (
                <Link href={`/sessions/${d.nextSession.id}`}>
                  <div className="relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-200 hover:card-glow">
                    {d.nextSessionCoverUrl && (
                      <>
                        <Image
                          src={d.nextSessionCoverUrl}
                          alt=""
                          fill
                          sizes="(min-width: 1024px) 1152px, 100vw"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-surface/40" />
                      </>
                    )}
                    <div className="relative flex items-start justify-between gap-3 p-6 sm:p-8">
                      <div className="min-w-0">
                        <p className="text-sm text-muted">Prochaine soirée</p>
                        <p className="mt-2 text-2xl font-semibold capitalize leading-tight text-foreground sm:text-3xl">
                          {formatDateTimeFr(d.nextSession.date)}
                        </p>
                        <p className="mt-2 truncate text-base text-foreground">
                          {d.nextSession.decidedGame
                            ? d.nextSession.decidedGame.name
                            : `${d.nextSession.proposals.length} proposition${d.nextSession.proposals.length === 1 ? "" : "s"}`}
                        </p>
                        {d.registeredPlayerCount > 0 && (
                          <p className="mt-1 text-sm text-muted">
                            {d.registeredPlayerCount} joueur{d.registeredPlayerCount === 1 ? "" : "s"} inscrit
                            {d.registeredPlayerCount === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${SESSION_STATUS_LABELS[d.nextSession.status].className}`}
                      >
                        {SESSION_STATUS_LABELS[d.nextSession.status].label}
                      </span>
                    </div>
                  </div>
                </Link>
              ) : (
                <EmptyState
                  icon="🎮"
                  title="Pas encore de soirée — crée la première 🎮"
                  action={
                    <ButtonLink href="/sessions" variant="primary">
                      Proposer une soirée
                    </ButtonLink>
                  }
                />
              )}
            </StaggerItem>

            <StaggerItem className="grid grid-cols-2 gap-3">
              <ButtonLink
                href="/jouer-maintenant"
                variant="primary"
                fullWidthOnMobile
                className="col-span-2 justify-center"
              >
                🎮 Jouer maintenant
              </ButtonLink>
              <ButtonLink href="/disponibilites" variant="secondary" size="sm">
                Mes dispos
              </ButtonLink>
              <ButtonLink href="/sessions" variant="secondary" size="sm">
                Soirées
              </ButtonLink>
            </StaggerItem>
          </section>

          {/* 2 — Cette semaine : dispos et activité. */}
          <section className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
            <StaggerItem>
              <Card className="gradient-border h-full">
                <p className="text-lg font-semibold text-foreground">Dispos de la semaine</p>
                <div className="mt-4 grid grid-cols-7 gap-1.5 sm:gap-2">
                  {d.weekAvailability.map((day) => (
                    <Link
                      key={day.date.toISOString()}
                      href={day.href}
                      className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors ${
                        day.isBest
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border text-foreground hover:bg-surface-hover"
                      }`}
                    >
                      <span className="text-[10px] uppercase text-muted">{day.label.slice(0, 3)}</span>
                      <span className="text-sm font-semibold">
                        {day.availableCount}/{day.totalUsers}
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gradient-border h-full">
                <p className="text-lg font-semibold text-foreground">Activité récente</p>
                {d.activity.length === 0 ? (
                  <EmptyState icon="📡" title="L'activité du groupe apparaîtra ici" className="mt-4" />
                ) : (
                  <ul className="mt-4 flex flex-col gap-3">
                    {d.activity.map((item) => (
                      <li key={item.id} className="flex items-center gap-3">
                        <span className="shrink-0 text-lg" aria-hidden>
                          {item.icon}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-sm text-foreground">{item.text}</p>
                        <span className="shrink-0 text-xs text-muted">
                          il y a {formatDurationFr(d.now - item.timestamp.getTime())}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </StaggerItem>
          </section>

          {/* 3 — Le groupe : classement et stats. */}
          <section className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
            <StaggerItem>
              <Card className="gradient-border h-full">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold text-foreground">Classement rapide</p>
                  <Link href="/classement" className="text-xs font-medium text-accent hover:underline">
                    Voir tout
                  </Link>
                </div>
                {podiumCount === 0 ? (
                  <p className="mt-4 text-sm text-muted">Personne dans le groupe pour l&apos;instant.</p>
                ) : (
                  <div className="mt-5 flex items-end justify-center gap-2 sm:gap-4">
                    {second && <PodiumSpot entry={second} place={2} />}
                    {first && <PodiumSpot entry={first} place={1} />}
                    {third && <PodiumSpot entry={third} place={3} />}
                  </div>
                )}
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gradient-border h-full">
                <p className="text-lg font-semibold text-foreground">Stats du groupe</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <CountUp
                      value={d.groupStats.totalSessionsPlayed}
                      className="text-2xl font-semibold tabular-nums text-foreground"
                    />
                    <p className="text-xs text-muted">
                      soirée{d.groupStats.totalSessionsPlayed === 1 ? "" : "s"} jouée
                      {d.groupStats.totalSessionsPlayed === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div>
                    <CountUp
                      value={d.groupStats.activePlayers}
                      className="text-2xl font-semibold tabular-nums text-foreground"
                    />
                    <p className="text-xs text-muted">
                      joueur{d.groupStats.activePlayers === 1 ? "" : "s"} actif
                      {d.groupStats.activePlayers === 1 ? "" : "s"}
                    </p>
                  </div>
                  {d.groupStats.mostPlayedGame && (
                    <div className="col-span-2 flex items-center gap-3">
                      {d.groupStats.mostPlayedGame.coverUrl && (
                        <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                          <Image
                            src={d.groupStats.mostPlayedGame.coverUrl}
                            alt=""
                            width={40}
                            height={56}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {d.groupStats.mostPlayedGame.name}
                        </p>
                        <p className="text-xs text-muted">
                          Jeu le plus joué · {d.groupStats.mostPlayedGame.count} fois
                        </p>
                      </div>
                    </div>
                  )}
                  {d.groupStats.bestActiveStreak && (
                    <div className="col-span-2">
                      <p className="text-sm font-medium text-foreground">
                        🔥 {d.groupStats.bestActiveStreak.discordName}
                      </p>
                      <p className="text-xs text-muted">
                        Meilleur streak actif · {d.groupStats.bestActiveStreak.streakCount} jour
                        {d.groupStats.bestActiveStreak.streakCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </StaggerItem>
          </section>

          {/* 4 — Le reste, même ordre que l'accueil actuel. */}
          <section className="flex flex-col gap-4">
            {d.seasonProgress && (
              <StaggerItem>
                <Link href="/saisons">
                  <Card className="flex flex-col gap-2">
                    <p className="text-sm text-muted">
                      🏆 {d.seasonProgress.name} — Jour {d.seasonProgress.dayOfMonth}/
                      {d.seasonProgress.totalDays}
                    </p>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.min(100, (d.seasonProgress.dayOfMonth / d.seasonProgress.totalDays) * 100)}%`,
                        }}
                      />
                    </div>
                  </Card>
                </Link>
              </StaggerItem>
            )}

            {d.lastMonthRecap && (
              <StaggerItem>
                <Link href={`/recap/${d.recapYear}/${d.recapMonth}`}>
                  <Card className="card-glow flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      📊 Le recap du mois dernier est prêt !
                    </p>
                    <span className="text-accent">→</span>
                  </Card>
                </Link>
              </StaggerItem>
            )}

            {d.activeTournament && (
              <StaggerItem>
                <Link href={`/tournois/${d.activeTournament.id}`}>
                  <Card className="card-glow flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        🏆 Tournoi en cours : {d.activeTournament.name}
                      </p>
                      <p className="truncate text-xs text-muted">{d.activeTournament.gameName}</p>
                    </div>
                    <span className="shrink-0 text-accent">→</span>
                  </Card>
                </Link>
              </StaggerItem>
            )}

            {d.gameNews.length > 0 && (
              <StaggerItem>
                <Card className="gradient-border">
                  <p className="text-lg font-semibold text-foreground">📰 Actu gaming</p>
                  <ul className="mt-4 flex flex-col gap-3">
                    {d.gameNews.map((item) => (
                      <li key={item.id}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-lg transition-colors hover:bg-surface-hover"
                        >
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                            {item.gameCoverUrl && (
                              <Image
                                src={item.gameCoverUrl}
                                alt=""
                                width={32}
                                height={32}
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{item.title}</p>
                            <p className="truncate text-xs text-muted">{item.gameName}</p>
                          </div>
                          <span className="shrink-0 text-xs text-faint">
                            il y a {formatDurationFr(d.now - item.publishedAt.getTime())}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </Card>
              </StaggerItem>
            )}

            {d.weeklyChallenge && (
<StaggerItem>
              <Card className="gradient-border">
                <p className="text-lg font-semibold text-foreground">🎯 Défi de la semaine</p>
                <p className="mt-3 text-foreground">{d.weeklyChallenge.description}</p>
                <p className={`mt-2 text-sm ${d.weeklyChallenge.completedAt ? "text-accent" : "text-muted"}`}>
                  {d.weeklyChallenge.completedAt
                    ? "✅ Complété !"
                    : "Complète-le depuis une soirée terminée cette semaine."}
                </p>
              </Card>
            </StaggerItem>
)}

            <StaggerItem>
              <Card className="gradient-border">
                <p className="text-lg font-semibold text-foreground">🏅 Trophées du groupe</p>
                <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-5">
                  {d.groupAchievements.map((a) => (
                    <div
                      key={a.id}
                      title={`${a.name} — ${a.description}`}
                      className={`flex flex-col items-center gap-1 text-center ${
                        a.unlockedAt ? "" : "opacity-30 grayscale"
                      }`}
                    >
                      <span className="text-2xl">{a.icon}</span>
                      <span className="w-full truncate text-[10px] text-muted">{a.name}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </StaggerItem>

            <StaggerItem>
              <Card className="gradient-border">
                <p className="text-lg font-semibold text-foreground">💀 Dettes du groupe</p>
                {d.activeDebts.length === 0 ? (
                  <EmptyState
                    icon="✨"
                    title="Personne ne doit rien — bravo le groupe !"
                    className="mt-4"
                  />
                ) : (
                  <ul className="mt-4 flex flex-col gap-3">
                    {d.activeDebts.map((debt) => {
                      const isDebtCreator = debt.session.createdById === user.id;
                      return (
                        <li
                          key={debt.id}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Avatar src={debt.debtor.discordAvatar} alt={debt.debtor.discordName} size={24} />
                            <span className="text-sm font-medium text-foreground">{debt.debtor.discordName}</span>
                          </div>
                          <p className="text-xs text-muted">{debt.reason}</p>
                          {debt.gage ? (
                            <p className="text-sm text-accent">Gage : {debt.gage}</p>
                          ) : (
                            <p className="text-xs text-warning">Gage pas encore défini.</p>
                          )}
                          {isDebtCreator && (
                            <div className="flex flex-wrap items-center gap-2">
                              <form action={setDebtGageAction} className="flex flex-1 gap-2">
                                <input type="hidden" name="debtId" value={debt.id} />
                                <input
                                  type="text"
                                  name="gage"
                                  aria-label="Gage"
                                  placeholder="Définir le gage…"
                                  defaultValue={debt.gage ?? ""}
                                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                />
                                <Button type="submit" variant="secondary" size="sm">
                                  OK
                                </Button>
                              </form>
                              <form action={markDebtPaidAction}>
                                <input type="hidden" name="debtId" value={debt.id} />
                                <Button type="submit" variant="ghost" size="sm">
                                  Soldée
                                </Button>
                              </form>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </StaggerItem>
          </section>
        </Stagger>

        <form
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <Button type="submit" variant="ghost" size="sm">
            Se déconnecter
          </Button>
        </form>
      </div>
    </PullToRefresh>
  );
}
