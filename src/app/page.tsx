import Image from "next/image";
import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { closeSessionIfDue } from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, formatDurationFr, nowMs, wallClockNow } from "@/lib/wallclock";
import { getRecentActivity, getGroupStats, getWeekAvailability, getRecentGameNews } from "@/lib/home";
import { getScoreboard } from "@/lib/scoreboard";
import { levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { getCurrentWeeklyChallenge } from "@/lib/weekly-challenges";
import { getActiveDebts, getActiveDebtorIds } from "@/lib/debts";
import { setDebtGageAction, markDebtPaidAction } from "@/app/dettes/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Logo } from "@/components/Logo";
import { RankAvatar } from "@/components/RankAvatar";
import { PodiumSpot } from "@/components/PodiumSpot";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Une erreur inattendue est survenue côté serveur pendant la connexion. Réessaie — si ça persiste, préviens l'admin.",
  AccessDenied: "La connexion a été refusée.",
  OAuthCallbackError:
    "La connexion Discord a échoué (lien de connexion expiré ou déjà utilisé). Réessaie.",
  Verification: "Le lien de connexion n'est plus valide. Réessaie.",
};

// Fix UX (PR 9/9) : ne matche que la forme exacte `/potes/<id>` — jamais
// une URL absolue ni un autre chemin — pour que `redirectTo` ne puisse
// jamais devenir un open redirect, même avant la vérification en base.
const POTE_REDIRECT_PATTERN = /^\/potes\/([a-zA-Z0-9]+)$/;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const session = await auth();
  const { error, redirect: redirectParam } = await searchParams;
  const errorMessage = error
    ? (AUTH_ERROR_MESSAGES[error] ??
      "La connexion a échoué. Réessaie dans un instant.")
    : null;

  if (!session?.user) {
    let redirectTarget: { path: string; pseudo: string } | null = null;
    const match = redirectParam ? POTE_REDIRECT_PATTERN.exec(redirectParam) : null;
    if (match) {
      const targetUser = await prisma.user.findUnique({
        where: { id: match[1] },
        select: { discordName: true },
      });
      if (targetUser) redirectTarget = { path: redirectParam!, pseudo: targetUser.discordName };
    }

    return (
      <div className="bg-hero-gradient flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <Card className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <Logo className="text-xl" />

          {errorMessage && (
            <p className="w-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <p className="text-muted">
            Connecte-toi avec ton compte Discord pour organiser la
            prochaine soirée jeux.
          </p>

          {redirectTarget && (
            <p className="w-full rounded-lg bg-accent/10 p-3 text-sm text-accent">
              Tu vas voir le profil de {redirectTarget.pseudo} après connexion.
            </p>
          )}

          <form
            action={async () => {
              "use server";
              await signIn(
                "discord",
                redirectTarget ? { redirectTo: redirectTarget.path } : undefined
              );
            }}
            className="w-full"
          >
            <Button
              type="submit"
              variant="primary"
              fullWidthOnMobile
              className="w-full gap-2 bg-[#5865F2] hover:bg-[#4752c4]"
            >
              Se connecter avec Discord
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const showOnboarding = await shouldShowOnboarding(user.id, user.onboardingCompleted);
  const badgeCount = showOnboarding
    ? await prisma.userBadge.count({ where: { userId: user.id } })
    : 0;

  const dueSession = await prisma.session.findFirst({
    where: { status: "VOTING", date: { lte: wallClockNow() } },
    select: { id: true },
    orderBy: { date: "asc" },
  });
  if (dueSession) await closeSessionIfDue(dueSession.id);

  const [
    nextSession,
    activity,
    groupStats,
    weekAvailability,
    scoreboard,
    gameNews,
    weeklyChallenge,
    groupAchievements,
    activeDebts,
    activeDebtorIds,
  ] = await Promise.all([
    prisma.session.findFirst({
      where: { status: { in: ["VOTING", "SCHEDULED"] } },
      orderBy: { date: "asc" },
      include: {
        decidedGame: { select: { name: true, coverUrl: true } },
        proposals: {
          select: {
            gameId: true,
            game: { select: { coverUrl: true } },
            votes: { select: { userId: true } },
          },
        },
      },
    }),
    getRecentActivity(3),
    getGroupStats(),
    getWeekAvailability(),
    getScoreboard("global"),
    getRecentGameNews(),
    getCurrentWeeklyChallenge(),
    prisma.groupAchievement.findMany({ orderBy: [{ unlockedAt: "desc" }, { createdAt: "asc" }] }),
    getActiveDebts(),
    getActiveDebtorIds(),
  ]);

  // Refonte home : cover du jeu décidé si la soirée est SCHEDULED, sinon
  // celle de la proposition la plus votée (VOTING) — même logique que
  // `bestSlot`/`topGroup` ailleurs (max sur un tableau déjà en mémoire, pas
  // besoin d'une requête triée dédiée pour si peu de propositions).
  const topProposal = nextSession?.proposals.reduce<
    (typeof nextSession.proposals)[number] | null
  >((best, p) => (!best || p.votes.length > best.votes.length ? p : best), null);
  const nextSessionCoverUrl = nextSession?.decidedGame?.coverUrl ?? topProposal?.game.coverUrl ?? null;

  // "Joueurs inscrits" : voteurs de la proposition gagnante une fois le
  // jeu décidé (mêmes personnes que le "Qui vient" Discord), sinon
  // l'ensemble des voteurs toutes propositions confondues (VOTING) — un
  // vote pour n'importe quel jeu proposé compte comme un "je suis
  // partant", cohérent avec le sens de "inscrit" avant que le jeu ne soit
  // tranché.
  const registeredPlayerIds = new Set<string>();
  if (nextSession) {
    const relevantProposals = nextSession.decidedGameId
      ? nextSession.proposals.filter((p) => p.gameId === nextSession.decidedGameId)
      : nextSession.proposals;
    for (const p of relevantProposals) {
      for (const v of p.votes) registeredPlayerIds.add(v.userId);
    }
  }

  const now = nowMs();
  const level = levelForXp(user.xpTotal);
  const rank = rankForLevel(level);
  const title = titleForLevel(level);
  const podium = scoreboard.slice(0, 3);
  const [first, second, third] = podium;

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      {showOnboarding && (
        <OnboardingFlow
          discordName={user.discordName}
          discordAvatar={user.discordAvatar}
          xpTotal={user.xpTotal}
          badgeCount={badgeCount}
        />
      )}

      <div className="flex items-center gap-4">
        <RankAvatar
          src={session.user.image ?? null}
          alt={`Avatar de ${session.user.name}`}
          level={level}
          rank={rank}
          size={64}
        />
        <div className="min-w-0">
          <p className="text-sm text-muted">Salut,</p>
          <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">
            {session.user.name}
            {activeDebtorIds.has(user.id) && (
              <span className="ml-1" title="Dette de gage active">
                💀
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-xs text-muted">
            Niveau {level} · {title} · {rank.name}
          </p>
        </div>
        {/* FIX1 (retours visuels post-Sprint2) : le bouton "?" flottant
            (`GuideFab`) est discret par design (coin d'écran, toujours
            visible) — pas assez visible en tant que point d'entrée
            principal vers le guide pour un nouvel utilisateur. Lien
            explicite ici, juste après l'en-tête, en plus du FAB (les deux
            coexistent, cf. spec). */}
        <ButtonLink href="/guide" variant="ghost" size="sm" className="shrink-0 !px-2">
          📖 Guide
        </ButtonLink>
      </div>

      <Stagger className="flex flex-col gap-4" staggerDelay={0.1}>
        {/* Prochaine soirée + Stats du groupe côte à côte sur desktop —
            l'espace vide à gauche/droite était le retour le plus fréquent
            en desktop (cf. README, section dédiée). */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
        <StaggerItem>
          {nextSession ? (
            <Link href={`/sessions/${nextSession.id}`}>
              {/* Pas de `Card` ici : `Card` impose son propre padding via
                  une classe fixe, pas fiable à écraser avec une classe
                  `p-0` passée en `className` (l'ordre de règles généré par
                  Tailwind ne garantit pas la victoire de la classe la plus
                  récente dans le JSX) — mêmes classes visuelles que `Card
                  glow` reproduites à la main pour pouvoir placer l'image de
                  fond en position absolue derrière un padding interne. */}
              <div className="relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-200 hover:card-glow">
                {nextSessionCoverUrl && (
                  <>
                    <Image
                      src={nextSessionCoverUrl}
                      alt=""
                      fill
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-surface/40" />
                  </>
                )}
                <div className="relative flex items-start justify-between gap-3 p-6 sm:p-8">
                  <div className="min-w-0">
                    <p className="text-sm text-muted">Prochaine soirée</p>
                    <p className="mt-1 text-lg font-semibold text-foreground capitalize">
                      {formatDateTimeFr(nextSession.date)}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted">
                      {nextSession.decidedGame
                        ? nextSession.decidedGame.name
                        : `${nextSession.proposals.length} proposition${nextSession.proposals.length === 1 ? "" : "s"}`}
                    </p>
                    {registeredPlayerIds.size > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {registeredPlayerIds.size} joueur{registeredPlayerIds.size === 1 ? "" : "s"} inscrit
                        {registeredPlayerIds.size === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${SESSION_STATUS_LABELS[nextSession.status].className}`}
                  >
                    {SESSION_STATUS_LABELS[nextSession.status].label}
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <Card>
              <p className="text-sm text-muted">
                Aucune soirée prévue pour l&apos;instant.
              </p>
              <ButtonLink href="/sessions" variant="primary" className="mt-4">
                Proposer une soirée
              </ButtonLink>
            </Card>
          )}
        </StaggerItem>

        {/* Stats du groupe */}
        <StaggerItem>
          <Card>
            <p className="text-sm text-muted">Stats du groupe</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {groupStats.totalSessionsPlayed}
                </p>
                <p className="text-xs text-muted">
                  soirée{groupStats.totalSessionsPlayed === 1 ? "" : "s"} jouée
                  {groupStats.totalSessionsPlayed === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">{groupStats.activePlayers}</p>
                <p className="text-xs text-muted">
                  joueur{groupStats.activePlayers === 1 ? "" : "s"} actif
                  {groupStats.activePlayers === 1 ? "" : "s"}
                </p>
              </div>
              {groupStats.mostPlayedGame && (
                <div className="col-span-2 flex items-center gap-3">
                  {groupStats.mostPlayedGame.coverUrl && (
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                      <Image
                        src={groupStats.mostPlayedGame.coverUrl}
                        alt=""
                        width={40}
                        height={56}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {groupStats.mostPlayedGame.name}
                    </p>
                    <p className="text-xs text-muted">
                      Jeu le plus joué · {groupStats.mostPlayedGame.count} fois
                    </p>
                  </div>
                </div>
              )}
              {groupStats.bestActiveStreak && (
                <div className="col-span-2">
                  <p className="text-sm font-medium text-foreground">
                    🔥 {groupStats.bestActiveStreak.discordName}
                  </p>
                  <p className="text-xs text-muted">
                    Meilleur streak actif · {groupStats.bestActiveStreak.streakCount} jour
                    {groupStats.bestActiveStreak.streakCount === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </StaggerItem>
        </div>

        {/* Activité récente + Dispos de la semaine côte à côte sur desktop */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-6">
        <StaggerItem>
          <Card>
            <p className="text-sm text-muted">Activité récente</p>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Rien à signaler pour l&apos;instant.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className="text-lg shrink-0" aria-hidden>
                      {item.icon}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground">{item.text}</p>
                    <span className="shrink-0 text-xs text-muted">
                      il y a {formatDurationFr(now - item.timestamp.getTime())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>

        {/* Dispos de la semaine */}
        <StaggerItem>
          <Card>
            <p className="text-sm text-muted">Dispos de la semaine</p>
            <div className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2">
              {weekAvailability.map((day) => (
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
        </div>

        {/* Actu gaming (Sprint 3) — cache uniquement (`GameNews`, rafraîchi
            par `runGameNewsBackfill`, jamais l'API Steam directement ici),
            entièrement masquée s'il n'y a aucune actu en cache (spec). */}
        {gameNews.length > 0 && (
          <StaggerItem>
            <Card>
              <p className="text-sm text-muted">📰 Actu gaming</p>
              <ul className="mt-3 flex flex-col gap-3">
                {gameNews.map((item) => (
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
                        il y a {formatDurationFr(now - item.publishedAt.getTime())}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        )}

        {/* Défi hebdo (Sprint 3 suite) — généré paresseusement pour la
            semaine en cours par `getCurrentWeeklyChallenge` ci-dessus. La
            complétion se fait depuis une soirée DONE (bouton créateur),
            jamais directement ici — la Home reste en lecture seule. */}
        <StaggerItem>
          <Card>
            <p className="text-sm text-muted">🎯 Défi de la semaine</p>
            <p className="mt-2 text-foreground">{weeklyChallenge.description}</p>
            <p className={`mt-2 text-sm ${weeklyChallenge.completedAt ? "text-accent" : "text-muted"}`}>
              {weeklyChallenge.completedAt
                ? "✅ Complété !"
                : "Complète-le depuis une soirée terminée cette semaine."}
            </p>
          </Card>
        </StaggerItem>

        {/* Trophées du groupe (Sprint 3 suite) — encyclopédique comme
            `BadgeGrid` : les 10 lignes sont toujours affichées, débloquées
            en couleur, verrouillées grisées. */}
        <StaggerItem>
          <Card>
            <p className="text-sm text-muted">🏅 Trophées du groupe</p>
            <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">
              {groupAchievements.map((a) => (
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

        {/* Dettes du groupe (Sprint 3 suite) — masquée s'il n'y a aucune
            dette active, même philosophie que "Actu gaming" ci-dessus.
            Définir le gage/marquer soldée réservé au créateur de la
            soirée qui a généré la dette (mêmes gardes côté serveur dans
            `src/app/dettes/actions.ts`). */}
        {activeDebts.length > 0 && (
          <StaggerItem>
            <Card>
              <p className="text-sm text-muted">💀 Dettes du groupe</p>
              <ul className="mt-3 flex flex-col gap-3">
                {activeDebts.map((debt) => {
                  const isDebtCreator = debt.session.createdById === user.id;
                  return (
                    <li
                      key={debt.id}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar
                          src={debt.debtor.discordAvatar}
                          alt={debt.debtor.discordName}
                          size={24}
                        />
                        <span className="text-sm font-medium text-foreground">
                          {debt.debtor.discordName}
                        </span>
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
                              placeholder="Définir le gage…"
                              defaultValue={debt.gage ?? ""}
                              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
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
            </Card>
          </StaggerItem>
        )}

        {/* Classement rapide */}
        <StaggerItem>
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">Classement rapide</p>
              <Link href="/classement" className="text-xs font-medium text-accent hover:underline">
                Voir tout
              </Link>
            </div>
            {podium.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Personne dans le groupe pour l&apos;instant.</p>
            ) : (
              <div className="mt-4 flex items-end justify-center gap-2 sm:gap-4">
                {second && <PodiumSpot entry={second} place={2} />}
                {first && <PodiumSpot entry={first} place={1} />}
                {third && <PodiumSpot entry={third} place={3} />}
              </div>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem className="grid grid-cols-2 gap-4">
          <ButtonLink href="/disponibilites" variant="secondary" size="sm">
            Mes dispos
          </ButtonLink>
          <ButtonLink href="/sessions" variant="secondary" size="sm">
            Soirées
          </ButtonLink>
        </StaggerItem>
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
